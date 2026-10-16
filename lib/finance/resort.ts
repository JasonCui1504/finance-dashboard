import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  UNCATEGORIZED,
  categorizeSlug,
  issuerSlug,
  legacySlug,
  matchMerchantRule,
  merchantKey,
  merchantName,
} from "./categories";
import { getDb } from "./db";
import { getTaxonomy } from "./taxonomy";

// --- Subscription detection --------------------------------------------------

type Charge = { id: number; date: string; description: string; amount: number; card_id: number };

export type Subscription = {
  key: string;
  name: string;
  card_id: number;
  /** Latest charge. */
  amount: number;
  /** The charge before a price change, when there was one. */
  previous_amount: number | null;
  since: string;
  last: string;
  count: number;
  /** Charged within ~40 days of the newest imported transaction. */
  active: boolean;
  /** First charged within ~2 months of the newest imported transaction. */
  is_new: boolean;
  tx_ids: number[];
};

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
// Subscriptions bill essentially the same amount each time; a real price
// change is handled separately below. Loose matching would turn a monthly
// gas fill-up into a "subscription".
const sameAmount = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.5, 0.02 * Math.max(a, b));

/** At least `min` charges about a month apart (no two within 20 days). */
function monthlyCadence(dates: string[], min = 3): boolean {
  if (dates.length < min) return false;
  const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
  const m = median(gaps);
  return Math.min(...gaps) >= 20 && m >= 26 && m <= 35;
}

/**
 * Charges from the same merchant, at (about) the same amount, about a month
 * apart, at least three times. Several subscriptions behind one merchant
 * (two Apple charges) are told apart by amount; a price change is allowed
 * when the new price continues the monthly rhythm. A merchant's one-off
 * purchases never join — DashPass is a subscription, the orders aren't.
 */
export function detectRecurring(charges: Charge[]): Subscription[] {
  const latest = charges.reduce((m, c) => (c.date > m ? c.date : m), "");
  const byKey = new Map<string, Charge[]>();
  for (const c of charges) {
    if (c.amount <= 0) continue;
    const key = merchantKey(c.description);
    if (key.length < 2) continue;
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(c);
  }

  const out: Subscription[] = [];
  for (const [key, list] of byKey) {
    if (list.length < 3) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    // Group by amount, each charge joining the cluster whose first amount it
    // matches (anchored, so a run of slightly different amounts can't drift).
    const clusters: Charge[][] = [];
    for (const c of list) {
      const home = clusters.find((cl) => sameAmount(cl[0].amount, c.amount));
      if (home) home.push(c);
      else clusters.push([c]);
    }
    clusters.sort((a, b) => a[0].date.localeCompare(b[0].date));
    const used = new Set<Charge[]>();
    for (const cl of clusters) {
      if (used.has(cl) || !monthlyCadence(cl.map((c) => c.date))) continue;
      used.add(cl);
      let txs = cl;
      let previous: number | null = null;
      // A new price picking up where this one stopped is the same subscription.
      const next = clusters.find(
        (o) =>
          !used.has(o) &&
          o[0].date > cl[cl.length - 1].date &&
          daysBetween(cl[cl.length - 1].date, o[0].date) >= 20 &&
          daysBetween(cl[cl.length - 1].date, o[0].date) <= 40 &&
          (o.length === 1 || monthlyCadence(o.map((c) => c.date), 2))
      );
      if (next) {
        used.add(next);
        previous = cl[cl.length - 1].amount;
        txs = [...cl, ...next];
      }
      const last = txs[txs.length - 1];
      out.push({
        key,
        name: merchantName(key),
        card_id: last.card_id,
        amount: last.amount,
        previous_amount: previous,
        since: txs[0].date,
        last: last.date,
        count: txs.length,
        active: daysBetween(last.date, latest) <= 40,
        is_new: daysBetween(txs[0].date, latest) <= 62,
        tx_ids: txs.map((t) => t.id),
      });
    }
  }
  return out.sort((a, b) => b.amount - a.amount);
}

// --- Re-sort plan --------------------------------------------------------------

type Tx = Charge & {
  is_card_credit: boolean;
  category_id: number | null;
  category_source: string;
  issuer_category: string | null;
  /** Text label, from the old six-category scheme until first re-sorted. */
  legacy: string;
};

export type ResortReason = "yours" | "rule" | "issuer" | "keyword" | "kept" | "old label" | "subscription";

export type ResortChange = {
  id: number;
  from: number | null;
  to: number | null;
  reason: ResortReason;
};

export type ResortReport = {
  total_transactions: number;
  changes: number;
  /** Per destination (null = Uncategorized), biggest first. */
  categories: {
    category_id: number | null;
    name: string;
    group: string | null;
    count: number;
    total: number;
    top_merchants: { name: string; total: number; count: number }[];
  }[];
  subscriptions: { name: string; amount: number; count: number }[];
};

async function loadTransactions(): Promise<Tx[]> {
  const db = await getDb();
  const rs = await db.execute(
    `SELECT id, date, description, amount, card_id, is_card_credit, category_id,
            category_source, issuer_category, category
     FROM transactions ORDER BY date, id`
  );
  return rs.rows.map((r) => ({
    id: Number(r.id),
    date: String(r.date),
    description: String(r.description),
    amount: Number(r.amount),
    card_id: Number(r.card_id),
    is_card_credit: Number(r.is_card_credit) === 1,
    category_id: r.category_id == null ? null : Number(r.category_id),
    category_source: String(r.category_source ?? "auto"),
    issuer_category: r.issuer_category == null ? null : String(r.issuer_category),
    legacy: String(r.category ?? ""),
  }));
}

/**
 * Where every transaction belongs under the current labels and rules:
 * your hand-picked category › a taught merchant rule › the issuer's label ›
 * the keyword rules › what it already has › (first time only) its old label.
 * Then monthly repeat charges move to Subscriptions unless they already sit
 * in a Fixed category or you've ruled on that merchant. Card credits are
 * left alone (they're reimbursements, not spending).
 */
export async function planResort(): Promise<{ changes: ResortChange[]; report: ResortReport }> {
  const db = await getDb();
  const [txs, tax, rulesRs] = await Promise.all([
    loadTransactions(),
    getTaxonomy(),
    db.execute("SELECT match_key, category_id FROM merchant_rules"),
  ]);
  const rules = rulesRs.rows.map((r) => ({
    match_key: String(r.match_key),
    category_id: r.category_id == null ? null : Number(r.category_id),
  }));
  const idBySlug = new Map(tax.categories.filter((c) => c.slug).map((c) => [c.slug!, c.id]));
  const catById = new Map(tax.categories.map((c) => [c.id, c]));
  const groupById = new Map(tax.groups.map((g) => [g.id, g]));
  const fixedGroup = tax.groups.find((g) => g.slug === "fixed");
  const subscriptionsId = idBySlug.get("subscriptions") ?? null;
  const fromSlug = (slug: string | null) => (slug ? (idBySlug.get(slug) ?? null) : null);

  const target = new Map<number, { to: number | null; reason: ResortReason }>();
  const ruled = new Set<number>();
  for (const t of txs) {
    if (t.is_card_credit) continue;
    if (t.category_source === "user") {
      target.set(t.id, { to: t.category_id, reason: "yours" });
      continue;
    }
    const rule = matchMerchantRule(t.description, rules);
    if (rule) {
      ruled.add(t.id);
      target.set(t.id, { to: rule.category_id, reason: "rule" });
      continue;
    }
    const byIssuer = fromSlug(issuerSlug(t.issuer_category));
    if (byIssuer != null) {
      target.set(t.id, { to: byIssuer, reason: "issuer" });
      continue;
    }
    const byKeyword = fromSlug(categorizeSlug(t.description));
    if (byKeyword != null) {
      target.set(t.id, { to: byKeyword, reason: "keyword" });
      continue;
    }
    if (t.category_id != null) {
      target.set(t.id, { to: t.category_id, reason: "kept" });
      continue;
    }
    target.set(t.id, { to: fromSlug(legacySlug(t.legacy)), reason: "old label" });
  }

  const subs = detectRecurring(txs.filter((t) => !t.is_card_credit));
  if (subscriptionsId != null) {
    for (const s of subs) {
      for (const id of s.tx_ids) {
        const cur = target.get(id);
        if (!cur || cur.reason === "yours" || ruled.has(id)) continue;
        const cat = cur.to != null ? catById.get(cur.to) : undefined;
        if (cat && fixedGroup && cat.group_id === fixedGroup.id) continue;
        target.set(id, { to: subscriptionsId, reason: "subscription" });
      }
    }
  }

  const changes: ResortChange[] = [];
  const buckets = new Map<
    number | null,
    { count: number; total: number; merchants: Map<string, { total: number; count: number }> }
  >();
  for (const t of txs) {
    const tg = target.get(t.id);
    if (!tg) continue;
    if (tg.to !== t.category_id) changes.push({ id: t.id, from: t.category_id, to: tg.to, reason: tg.reason });
    const b = buckets.get(tg.to) ?? { count: 0, total: 0, merchants: new Map() };
    b.count += 1;
    b.total += t.amount;
    const name = merchantName(merchantKey(t.description) || t.description.toLowerCase());
    const m = b.merchants.get(name) ?? { total: 0, count: 0 };
    m.total += t.amount;
    m.count += 1;
    b.merchants.set(name, m);
    buckets.set(tg.to, b);
  }

  const report: ResortReport = {
    total_transactions: target.size,
    changes: changes.length,
    categories: [...buckets.entries()]
      .map(([id, b]) => {
        const cat = id != null ? catById.get(id) : undefined;
        return {
          category_id: id,
          name: cat?.name ?? UNCATEGORIZED,
          group: cat ? (groupById.get(cat.group_id)?.name ?? null) : null,
          count: b.count,
          total: Math.round(b.total * 100) / 100,
          top_merchants: [...b.merchants.entries()]
            .map(([name, m]) => ({ name, total: Math.round(m.total * 100) / 100, count: m.count }))
            .sort((a, z) => z.total - a.total)
            .slice(0, 5),
        };
      })
      .sort((a, z) => z.total - a.total),
    subscriptions: subs
      .filter((s) => s.active)
      .map((s) => ({ name: s.name, amount: s.amount, count: s.count })),
  };
  return { changes, report };
}

/** Same-disk copy of the database before a bulk change (local file only). */
async function backup(label: string): Promise<string | null> {
  const url = process.env.FINANCE_DATABASE_URL ?? "file:.data/finance.db";
  if (!url.startsWith("file:")) return null;
  const dir = join(homedir(), "finance-backups");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const path = join(dir, `finance-before-${label}-${stamp}.db`);
  const db = await getDb();
  await db.execute({ sql: "VACUUM INTO ?", args: [path] });
  return path;
}

async function writeChanges(changes: ResortChange[]): Promise<void> {
  if (changes.length === 0) return;
  const db = await getDb();
  const names = new Map((await getTaxonomy()).categories.map((c) => [c.id, c.name]));
  for (let i = 0; i < changes.length; i += 500) {
    await db.batch(
      changes.slice(i, i + 500).map((c) => ({
        // The text column mirrors the label for anything still reading it.
        sql: "UPDATE transactions SET category_id = ?, category = ? WHERE id = ?",
        args: [c.to, c.to != null ? (names.get(c.to) ?? UNCATEGORIZED) : UNCATEGORIZED, c.id],
      })),
      "write"
    );
  }
}

/** The full re-sort, after a backup. */
export async function applyResort(): Promise<{ changed: number; backup: string | null }> {
  const { changes } = await planResort();
  const path = changes.length ? await backup("resort") : null;
  await writeChanges(changes);
  const db = await getDb();
  await db.batch(
    [
      "INSERT INTO settings (key, value) VALUES ('spending_resorted', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      // The one-time "please re-sort" notice from the migration has done its job.
      "UPDATE dashboard_warnings SET dismissed_at = datetime('now') WHERE dismissed_at IS NULL AND text LIKE 'Spending now uses Fixed / Essentials / Travel / Lifestyle.%'",
    ],
    "write"
  );
  return { changed: changes.length, backup: path };
}

/**
 * After an import: only move newly detected monthly charges into
 * Subscriptions, so a merchant's third monthly charge also re-labels the
 * first two. Nothing else changes without the reviewed re-sort.
 */
export async function applySubscriptionPass(): Promise<number> {
  const { changes } = await planResort();
  const subs = changes.filter((c) => c.reason === "subscription");
  await writeChanges(subs);
  return subs.length;
}

/** Monthly subscriptions currently being charged, for the dashboard. */
export async function listSubscriptions(): Promise<Subscription[]> {
  const txs = await loadTransactions();
  return detectRecurring(txs.filter((t) => !t.is_card_credit)).filter((s) => s.active);
}
