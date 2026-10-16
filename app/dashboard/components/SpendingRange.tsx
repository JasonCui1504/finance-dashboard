"use client";

import { useState } from "react";
import CategoryDonut, { OTHER, SLOTS } from "./CategoryDonut";
import GroupBreakdown, { type BreakdownCategory, type BreakdownGroup } from "./GroupBreakdown";
import { DELTA_DOWN, DELTA_UP, fmtPct, fmtUSD } from "./format";
import SpendingRangeChart, {
  FIXED_COLOR,
  SPENT_COLOR,
  shortDate,
  type SpendBucket,
} from "./SpendingRangeChart";

// The chart's hatch for bills and monthly totals, as a CSS fill.
const FIXED_FILL = `repeating-linear-gradient(45deg, ${FIXED_COLOR} 0 2px, ${FIXED_COLOR}38 2px 5px)`;

const DAYS_PER_MONTH = 365.25 / 12;

type CardRef = { id: number; name: string; issuer: string };
type BillRef = { id: number; name: string };
type Day = {
  date: string;
  card_id: number;
  category_id: number | null;
  credit: boolean;
  spent: number;
  returned: number;
};
type MerchantDay = { date: string; name: string; category_id: number | null; amount: number };
type Monthly = {
  month: string;
  card_id: number | null;
  bill_id: number | null;
  category_id: number | null;
  amount: number;
};
type Taxonomy = {
  groups: { id: number; name: string }[];
  categories: { id: number; group_id: number; name: string }[];
};
type Budget = { group_id: number | null; category_id: number | null; monthly_limit: number };

// Category keys within a window: a category id, or one of the buckets that
// aren't categories — card credits, uncategorized, a card's manual total.
const CREDITS = "credits";
const NONE = "none";
const MANUAL = "manual";
const catKey = (id: number | null) => (id == null ? NONE : `c${id}`);

type Preset = "30" | "90" | "ytd" | "custom";
const PRESETS: { key: Preset; label: string }[] = [
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "ytd", label: "Year to date" },
  { key: "custom", label: "Custom" },
];

// --- dates as YYYY-MM-DD strings, in UTC like the rest of the dashboard ---
const toDate = (d: string) => new Date(d + "T00:00:00Z");
const iso = (d: Date) => d.toISOString().slice(0, 10);
function addDays(d: string, n: number): string {
  const x = toDate(d);
  x.setUTCDate(x.getUTCDate() + n);
  return iso(x);
}
const dayCount = (from: string, to: string) =>
  Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000) + 1;
function shiftYear(d: string, n: number): string {
  const x = toDate(d);
  x.setUTCFullYear(x.getUTCFullYear() + n);
  return iso(x);
}
function longDate(d: string): string {
  return toDate(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}


type Totals = {
  /** Card purchases. */
  spent: number;
  /** Monthly-only amounts (bills, manual card totals), counted on the 1st. */
  fixed: number;
  returned: number;
  byCard: Map<number, number>;
  byBill: Map<number, number>;
  /** By catKey (see above), card credits under CREDITS. */
  byCategory: Map<string, number>;
};

/** Net spending in [from, to]; a monthly-only amount counts if its 1st falls inside. */
function totalsFor(days: Day[], monthly: Monthly[], from: string, to: string): Totals {
  const t: Totals = { spent: 0, fixed: 0, returned: 0, byCard: new Map(), byBill: new Map(), byCategory: new Map() };
  const add = <K,>(m: Map<K, number>, k: K, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const d of days) {
    if (d.date < from || d.date > to) continue;
    t.spent += d.spent;
    t.returned += d.returned;
    add(t.byCard, d.card_id, d.spent + d.returned);
    add(t.byCategory, d.credit ? CREDITS : catKey(d.category_id), d.spent + d.returned);
  }
  for (const m of monthly) {
    const first = `${m.month}-01`;
    if (first < from || first > to) continue;
    t.fixed += m.amount;
    if (m.card_id != null) add(t.byCard, m.card_id, m.amount);
    if (m.bill_id != null) add(t.byBill, m.bill_id, m.amount);
    add(t.byCategory, m.bill_id != null ? catKey(m.category_id) : MANUAL, m.amount);
  }
  return t;
}

/** Top merchants per category key in [from, to], biggest first. */
function merchantsFor(rows: MerchantDay[], from: string, to: string): Map<string, { name: string; total: number }[]> {
  const sums = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (r.date < from || r.date > to) continue;
    const k = catKey(r.category_id);
    const m = sums.get(k) ?? sums.set(k, new Map()).get(k)!;
    m.set(r.name, (m.get(r.name) ?? 0) + r.amount);
  }
  const out = new Map<string, { name: string; total: number }[]>();
  for (const [k, m] of sums) {
    out.set(
      k,
      [...m.entries()]
        .map(([name, total]) => ({ name, total }))
        .filter((x) => Math.abs(x.total) >= 0.005)
        .sort((a, b) => b.total - a.total)
        .slice(0, 6)
    );
  }
  return out;
}

/** Buckets of `size` days ending on `to`, so the newest bar is always whole. */
function bucketsFor(days: Day[], monthly: Monthly[], from: string, to: string, size: number): SpendBucket[] {
  const perDay = new Map<string, { spent: number; fixed: number; returned: number }>();
  const bump = (date: string, spent: number, fixed: number, returned: number) => {
    const v = perDay.get(date) ?? { spent: 0, fixed: 0, returned: 0 };
    v.spent += spent;
    v.fixed += fixed;
    v.returned += returned;
    perDay.set(date, v);
  };
  for (const d of days) if (d.date >= from && d.date <= to) bump(d.date, d.spent, 0, d.returned);
  // Rent and other monthly amounts land whole on the 1st of their month.
  for (const m of monthly) {
    const first = `${m.month}-01`;
    if (first >= from && first <= to) bump(first, 0, m.amount, 0);
  }
  const out: SpendBucket[] = [];
  for (let end = to; end >= from; end = addDays(end, -size)) {
    const start = addDays(end, -(size - 1)) < from ? from : addDays(end, -(size - 1));
    const b: SpendBucket = { start, end, spent: 0, fixed: 0, returned: 0 };
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const v = perDay.get(d);
      if (v) {
        b.spent += v.spent;
        b.fixed += v.fixed;
        b.returned += v.returned;
      }
    }
    out.push(b);
  }
  return out.reverse();
}

const autoBarDays = (len: number) => (len <= 45 ? 2 : len <= 120 ? 3 : 7);

/**
 * Spending over a chosen window (rolling 30 / 90 days, year to date, or any
 * dates) instead of calendar months, so a return a few weeks after the
 * purchase lands in the same window rather than flattering the next month.
 */
export default function SpendingRange({
  cards,
  bills,
  days,
  merchants,
  monthly,
  taxonomy,
  budgets,
  today,
}: {
  cards: CardRef[];
  bills: BillRef[];
  days: Day[];
  merchants: MerchantDay[];
  monthly: Monthly[];
  taxonomy: Taxonomy;
  budgets: Budget[];
  today: string;
}) {
  const [preset, setPreset] = useState<Preset>("30");
  const [custom, setCustom] = useState({ from: addDays(today, -29), to: today });
  const [barChoice, setBarChoice] = useState<"auto" | number>("auto");

  let from: string;
  let to = today;
  if (preset === "30") from = addDays(today, -29);
  else if (preset === "90") from = addDays(today, -89);
  else if (preset === "ytd") from = `${today.slice(0, 4)}-01-01`;
  else {
    from = custom.from <= custom.to ? custom.from : custom.to;
    to = custom.from <= custom.to ? custom.to : custom.from;
  }
  const len = dayCount(from, to);
  // Year to date compares with the same dates last year; any other window
  // with the same number of days just before it.
  const [prevFrom, prevTo] =
    preset === "ytd" ? [shiftYear(from, -1), shiftYear(to, -1)] : [addDays(from, -len), addDays(from, -1)];
  const barDays = barChoice === "auto" ? autoBarDays(len) : barChoice;

  const cur = totalsFor(days, monthly, from, to);
  const prev = totalsFor(days, monthly, prevFrom, prevTo);
  const buckets = bucketsFor(days, monthly, from, to, barDays);

  // Only compare when the data reaches back to the start of the earlier
  // window — otherwise it reads as a huge jump that's really missing data.
  const earliest = [days[0]?.date, ...monthly.map((m) => `${m.month}-01`)]
    .filter((d): d is string => !!d)
    .sort()[0];
  const comparable = earliest != null && earliest <= prevFrom;
  const net = cur.spent + cur.fixed + cur.returned;
  const prevNet = prev.spent + prev.fixed + prev.returned;
  // Card data ends at the newest imported transaction; after it the chart
  // shows only bills and monthly totals, which would read as quiet days.
  const lastImported = days.length > 0 ? days[days.length - 1].date : null;

  const changePct = comparable && prevNet > 0 ? ((net - prevNet) / prevNet) * 100 : null;
  const prevLabel = preset === "ytd" ? "same period last year" : `previous ${len} days`;
  const prevShort = preset === "ytd" ? "last year" : `prior ${len} days`;

  const credits = cur.byCategory.get(CREDITS) ?? 0;
  // Monthly budgets scaled to the window's length.
  const scale = (limit: number) => Math.round(((limit * len) / DAYS_PER_MONTH) * 100) / 100;
  const groupBudget = new Map(budgets.filter((b) => b.group_id != null).map((b) => [b.group_id!, scale(b.monthly_limit)]));
  const catBudget = new Map(
    budgets.filter((b) => b.category_id != null).map((b) => [b.category_id!, scale(b.monthly_limit)])
  );
  const tops = merchantsFor(merchants, from, to);
  const row = (key: string, name: string, budget: number | null): BreakdownCategory => ({
    key,
    name,
    total: cur.byCategory.get(key) ?? 0,
    prev: comparable ? (prev.byCategory.get(key) ?? 0) : null,
    budget,
    merchants: tops.get(key) ?? [],
  });
  const sum = (rows: BreakdownCategory[], f: (r: BreakdownCategory) => number | null) =>
    rows.some((r) => f(r) == null) ? null : rows.reduce((s, r) => s + (f(r) ?? 0), 0);
  // Groups keep their colour by position (Fixed is always the first slot),
  // so a colour means the same group in every window.
  const groupRows: BreakdownGroup[] = taxonomy.groups.map((g, i) => {
    const cats = taxonomy.categories
      .filter((c) => c.group_id === g.id)
      .map((c) => row(catKey(c.id), c.name, catBudget.get(c.id) ?? null))
      .sort((a, b) => b.total - a.total);
    return {
      key: `g${g.id}`,
      name: g.name,
      color: SLOTS[i] ?? OTHER,
      total: cats.reduce((s, c) => s + c.total, 0),
      prev: sum(cats, (c) => c.prev),
      budget: groupBudget.get(g.id) ?? null,
      merchants: [],
      categories: cats,
    };
  });
  const unsorted = [row(NONE, "Uncategorized", null), row(MANUAL, "Card totals (no statement)", null)];
  groupRows.push({
    key: "unsorted",
    name: "Uncategorized",
    color: OTHER,
    total: unsorted.reduce((s, c) => s + c.total, 0),
    prev: sum(unsorted, (c) => c.prev),
    budget: null,
    merchants: [],
    categories: unsorted,
  });
  // Only what has activity in the window, biggest first.
  const cardRows = cards
    .map((c) => ({ key: `card-${c.id}`, name: c.name, amount: cur.byCard.get(c.id) ?? 0 }))
    .filter((r) => Math.abs(r.amount) >= 0.005)
    .sort((a, b) => b.amount - a.amount);
  const billRows = bills
    .map((b) => ({ key: `bill-${b.id}`, name: b.name, amount: cur.byBill.get(b.id) ?? 0 }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const cardsTotal = cardRows.reduce((s, r) => s + r.amount, 0);
  const billsTotal = billRows.reduce((s, r) => s + r.amount, 0);
  const partial = lastImported != null && lastImported < to;

  const chip = (on: boolean) =>
    `rounded px-2.5 py-1 text-xs transition-colors ${on ? "bg-lift text-prose" : "text-faint hover:text-subtle"}`;
  const dateCls =
    "rounded-md border border-line bg-canvas px-2 py-1 text-xs text-prose outline-none focus:border-accent";

  return (
    <div className="flex flex-col gap-5">
      {/* One row of controls scoping everything below it. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex gap-1 rounded-md border border-line p-0.5" role="group" aria-label="Date range">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={preset === p.key}
              onClick={() => setPreset(p.key)}
              className={chip(preset === p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex items-center gap-1.5 text-xs text-faint">
            <input
              type="date"
              aria-label="From"
              value={custom.from}
              max={today}
              onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })}
              className={dateCls}
            />
            to
            <input
              type="date"
              aria-label="To"
              value={custom.to}
              max={today}
              onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })}
              className={dateCls}
            />
          </div>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-faint">
          Each bar
          <select
            value={String(barChoice)}
            onChange={(e) => setBarChoice(e.target.value === "auto" ? "auto" : Number(e.target.value))}
            className="rounded-md border border-line bg-canvas px-2 py-1 text-xs text-prose outline-none focus:border-accent"
          >
            <option value="auto">auto ({autoBarDays(len)} days)</option>
            <option value="1">1 day</option>
            <option value="2">2 days</option>
            <option value="3">3 days</option>
            <option value="7">1 week</option>
            <option value="14">2 weeks</option>
          </select>
        </label>
      </div>

      <div className="grid gap-6 md:grid-cols-[300px_1fr]">
        <div>
          <p className="text-3xl text-prose tabular-nums">{fmtUSD(net)}</p>
          <p className="mt-1 text-xs text-faint">
            {/* Years only when the window isn't within this year. */}
            {from.slice(0, 4) === today.slice(0, 4) && to.slice(0, 4) === today.slice(0, 4)
              ? `${shortDate(from)} – ${shortDate(to)}`
              : `${longDate(from)} – ${longDate(to)}`}
            {changePct != null && (
              <span
                className="ml-2"
                style={{ color: changePct <= 0 ? DELTA_UP : DELTA_DOWN }}
                title={`${prevLabel}: ${fmtUSD(prevNet)}`}
              >
                {fmtPct(changePct, 0)} vs {prevShort}
              </span>
            )}
            {/* Past the newest statement the window is missing card spending. */}
            {changePct != null && partial && (
              <span title={`Card statements imported only through ${shortDate(lastImported!)}`}> (partial)</span>
            )}
          </p>

          {/* Cards vs bills at a glance: one bar, then each group's items. */}
          {cardsTotal + billsTotal > 0 && (
            <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
              {cardsTotal > 0 && (
                <div style={{ flexGrow: cardsTotal, background: SPENT_COLOR }} />
              )}
              {billsTotal > 0 && <div style={{ flexGrow: billsTotal, background: FIXED_FILL }} />}
            </div>
          )}
          {[
            { label: "Credit cards", total: cardsTotal, fill: SPENT_COLOR, rows: cardRows },
            { label: "Bills", total: billsTotal, fill: FIXED_FILL, rows: billRows },
          ]
            .filter((g) => g.rows.length > 0)
            .map((g) => (
              <div key={g.label} className="mt-4">
                <div className="flex items-baseline gap-2 text-sm">
                  <span className="h-2.5 w-2.5 shrink-0 self-center rounded-sm" style={{ background: g.fill }} aria-hidden />
                  <span className="text-prose">{g.label}</span>
                  <span className="ml-auto tabular-nums text-prose">{fmtUSD(g.total)}</span>
                </div>
                <ul className="mt-1.5 flex flex-col gap-1 pl-[18px] text-xs">
                  {g.rows.map((r) => (
                    <li key={r.key} className="flex items-baseline gap-2">
                      <span className="truncate text-faint">{r.name}</span>
                      <span className="ml-auto tabular-nums text-subtle">{fmtUSD(r.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
        <div>
          <SpendingRangeChart
            key={`${from}|${to}|${barDays}`}
            buckets={buckets}
            lastImported={lastImported}
          />
          <details className="mt-2 text-xs text-faint">
            <summary className="cursor-pointer select-none hover:text-subtle">Show as table</summary>
            <div className="mt-2 max-h-56 overflow-y-auto">
              <table className="w-full tabular-nums">
                <thead>
                  <tr className="text-left">
                    <th className="pb-1 font-normal">Dates</th>
                    <th className="pb-1 text-right font-normal">Card purchases</th>
                    <th className="pb-1 text-right font-normal">Bills &amp; monthly</th>
                    <th className="pb-1 text-right font-normal">Returns &amp; credits</th>
                    <th className="pb-1 text-right font-normal">Net</th>
                  </tr>
                </thead>
                <tbody className="text-subtle">
                  {[...buckets].reverse().map((b) => (
                    <tr key={b.start} className="border-t border-line">
                      <td className="py-1">
                        {b.start === b.end ? shortDate(b.start) : `${shortDate(b.start)} – ${shortDate(b.end)}`}
                      </td>
                      <td className="py-1 text-right">{fmtUSD(b.spent)}</td>
                      <td className="py-1 text-right">{b.fixed ? fmtUSD(b.fixed) : "—"}</td>
                      <td className="py-1 text-right">{b.returned ? fmtUSD(-b.returned) : "—"}</td>
                      <td className="py-1 text-right text-prose">{fmtUSD(b.spent + b.fixed + b.returned)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </div>

      <div className="border-t border-line pt-5">
        <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-xs text-faint">By group · click one for its categories and merchants</p>
          {credits !== 0 && (
            <span className="text-xs text-faint">
              total includes <span className="tabular-nums text-[#17a06b]">{fmtUSD(credits)}</span> of card credits
            </span>
          )}
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,400px)_1fr]">
          <CategoryDonut
            slices={groupRows
              .filter((g) => g.total > 0)
              .map((g) => ({ label: g.name, value: g.total, color: g.color }))}
          />
          <div>
            <p className="mb-2 text-xs text-faint">
              Net of returns
              {budgets.length > 0 ? ` · vs budget scaled to ${len} days` : ""}
              {comparable ? ` · % vs ${prevLabel}` : ""}
            </p>
            <GroupBreakdown groups={groupRows} trendLabel={`vs the ${prevLabel}`} />
          </div>
        </div>
      </div>
    </div>
  );
}
