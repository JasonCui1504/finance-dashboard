import type { Row } from "@libsql/client";
import { getDb } from "./db";
import { monthlyFactor } from "./tax";

export type AccountType = "brokerage" | "bank" | "cd" | "retirement";

export type Account = {
  id: number;
  name: string;
  type: AccountType;
  institution: string;
  last_balance: number | null;
  balance_updated_at: string | null;
  apy: number | null;
};

export type Holding = {
  id: number;
  account_id: number | null;
  ticker: string;
  shares: number;
  cost_basis: number | null;
  purchase_date: string | null;
  manual_price: number | null;
  broker: string | null;
};

export type Cd = {
  id: number;
  bank_name: string;
  principal: number;
  apy: number;
  open_date: string;
  maturity_date: string;
  term_months: number | null;
};

export type IncomeStream = {
  id: number;
  source_name: string;
  /** Take-home for the period — tax has already been removed. */
  amount: number;
  frequency: "paycheck" | "one_off" | "weekly" | "biweekly" | "monthly" | "irregular";
  date_received: string | null;
  /** Tax withheld for the same period, or null when not recorded. */
  tax_withheld: number | null;
};

export type Snapshot = {
  id: number;
  date: string;
  total_net_worth: number;
  total_brokerage: number;
  total_bank: number;
  total_cds: number;
  total_retirement: number;
  day_change_pct: number | null;
  allocation_breakdown: Record<string, number>;
};

export type LatestPrice = {
  ticker: string;
  price: number;
  prev_close: number | null;
  fetched_at: string;
};

export type CreditCard = {
  id: number;
  name: string;
  issuer: string;
};

export type CardPayment = {
  id: number;
  card_id: number;
  month: string; // 'YYYY-MM'
  amount: number;
  note: string | null;
};

export type MonthlySpending = { month: string; total: number };

export type Transaction = {
  id: number;
  card_id: number;
  date: string; // 'YYYY-MM-DD'
  description: string;
  amount: number;
  category: string;
  is_card_credit: boolean;
  benefit_id: number | null;
  /** Collapsed out of the Manage list. Deliberately ignored by every total. */
  hidden: boolean;
};

export type Budget = { id: number; category: string; monthly_limit: number };

export type CategorySpend = { category: string; total: number };

// Net-worth categories that can be shown/hidden on the dashboard.
export const NET_WORTH_CATEGORIES = ["brokerage", "bank", "cds", "retirement"] as const;
export type NetWorthCategory = (typeof NET_WORTH_CATEGORIES)[number];

export type FinanceSettings = { hidden_categories: NetWorthCategory[] };

export async function getSettings(): Promise<FinanceSettings> {
  const db = await getDb();
  const rs = await db.execute("SELECT key, value FROM settings");
  const map = new Map(rs.rows.map((r) => [String(r.key), String(r.value)]));
  let hidden: unknown = [];
  try {
    hidden = JSON.parse(map.get("hidden_categories") ?? "[]");
  } catch {
    hidden = [];
  }
  const valid = new Set<string>(NET_WORTH_CATEGORIES);
  return {
    hidden_categories: Array.isArray(hidden)
      ? (hidden.filter((c) => valid.has(String(c))) as NetWorthCategory[])
      : [],
  };
}

export async function setHiddenCategories(
  categories: NetWorthCategory[]
): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO settings (key, value) VALUES ('hidden_categories', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [JSON.stringify(categories)],
  });
}

function num(v: unknown): number {
  return typeof v === "bigint" ? Number(v) : (v as number);
}

function rowToAccount(r: Row): Account {
  return {
    id: num(r.id),
    name: String(r.name),
    type: r.type as Account["type"],
    institution: String(r.institution ?? ""),
    last_balance: r.last_balance == null ? null : num(r.last_balance),
    balance_updated_at:
      r.balance_updated_at == null ? null : String(r.balance_updated_at),
    apy: r.apy == null ? null : num(r.apy),
  };
}

function rowToSnapshot(r: Row): Snapshot {
  let allocation: Record<string, number> = {};
  try {
    allocation = JSON.parse(String(r.allocation_breakdown ?? "{}"));
  } catch {
    /* keep empty */
  }
  return {
    id: num(r.id),
    date: String(r.date),
    total_net_worth: num(r.total_net_worth),
    total_brokerage: num(r.total_brokerage),
    total_bank: num(r.total_bank),
    total_cds: num(r.total_cds),
    total_retirement: r.total_retirement == null ? 0 : num(r.total_retirement),
    day_change_pct: r.day_change_pct == null ? null : num(r.day_change_pct),
    allocation_breakdown: allocation,
  };
}

export async function listAccounts(): Promise<Account[]> {
  const db = await getDb();
  const rs = await db.execute("SELECT * FROM accounts ORDER BY type, name");
  return rs.rows.map(rowToAccount);
}

export async function listHoldings(): Promise<Holding[]> {
  const db = await getDb();
  const rs = await db.execute("SELECT * FROM holdings ORDER BY ticker");
  return rs.rows.map((r) => ({
    id: num(r.id),
    account_id: r.account_id == null ? null : num(r.account_id),
    ticker: String(r.ticker),
    shares: num(r.shares),
    cost_basis: r.cost_basis == null ? null : num(r.cost_basis),
    purchase_date: r.purchase_date == null ? null : String(r.purchase_date),
    manual_price: r.manual_price == null ? null : num(r.manual_price),
    broker: r.broker == null ? null : String(r.broker),
  }));
}

export async function listCds(): Promise<Cd[]> {
  const db = await getDb();
  const rs = await db.execute("SELECT * FROM cds ORDER BY maturity_date");
  return rs.rows.map((r) => ({
    id: num(r.id),
    bank_name: String(r.bank_name),
    principal: num(r.principal),
    apy: num(r.apy),
    open_date: String(r.open_date),
    maturity_date: String(r.maturity_date),
    term_months: r.term_months == null ? null : num(r.term_months),
  }));
}

export async function listIncomeStreams(): Promise<IncomeStream[]> {
  const db = await getDb();
  const rs = await db.execute(
    "SELECT * FROM income_streams ORDER BY date_received DESC, source_name"
  );
  return rs.rows.map((r) => ({
    id: num(r.id),
    source_name: String(r.source_name),
    amount: num(r.amount),
    frequency: r.frequency as IncomeStream["frequency"],
    date_received: r.date_received == null ? null : String(r.date_received),
    tax_withheld: r.tax_withheld == null ? null : num(r.tax_withheld),
  }));
}

export async function getLatestSnapshot(): Promise<Snapshot | null> {
  const db = await getDb();
  const rs = await db.execute(
    "SELECT * FROM daily_snapshots ORDER BY date DESC LIMIT 1"
  );
  return rs.rows.length ? rowToSnapshot(rs.rows[0]) : null;
}

/** Snapshots oldest first: the newest `limit`, or every one when `limit` is null. */
export async function getSnapshotHistory(limit: number | null = 365): Promise<Snapshot[]> {
  const db = await getDb();
  const rs = await db.execute({
    sql: "SELECT * FROM (SELECT * FROM daily_snapshots ORDER BY date DESC LIMIT ?) ORDER BY date ASC",
    // SQLite treats a negative LIMIT as no limit.
    args: [limit ?? -1],
  });
  return rs.rows.map(rowToSnapshot);
}

export async function getLatestPrices(): Promise<Map<string, LatestPrice>> {
  const db = await getDb();
  const rs = await db.execute("SELECT * FROM latest_prices");
  const map = new Map<string, LatestPrice>();
  for (const r of rs.rows) {
    map.set(String(r.ticker), {
      ticker: String(r.ticker),
      price: num(r.price),
      prev_close: r.prev_close == null ? null : num(r.prev_close),
      fetched_at: String(r.fetched_at),
    });
  }
  return map;
}

/**
 * Current value of a CD assuming daily-compounded APY from open date,
 * frozen at maturity. An approximation — good enough for net-worth tracking.
 */
export function cdCurrentValue(cd: Cd, now = new Date()): number {
  const open = new Date(cd.open_date + "T00:00:00Z").getTime();
  const maturity = new Date(cd.maturity_date + "T00:00:00Z").getTime();
  const at = Math.min(now.getTime(), maturity);
  const years = Math.max(0, (at - open) / (365.25 * 24 * 3600 * 1000));
  return cd.principal * Math.pow(1 + cd.apy / 100, years);
}

/** Full projected value at maturity: principal grown at APY, open → maturity. */
export function cdMaturityValue(cd: Cd): number {
  return cdCurrentValue(cd, new Date(cd.maturity_date + "T00:00:00Z"));
}

export async function listCreditCards(): Promise<CreditCard[]> {
  const db = await getDb();
  const rs = await db.execute("SELECT * FROM credit_cards ORDER BY name");
  return rs.rows.map((r) => ({
    id: num(r.id),
    name: String(r.name),
    issuer: String(r.issuer ?? ""),
  }));
}

export async function listCardPayments(): Promise<CardPayment[]> {
  const db = await getDb();
  const rs = await db.execute(
    "SELECT * FROM card_payments ORDER BY month DESC, card_id"
  );
  return rs.rows.map((r) => ({
    id: num(r.id),
    card_id: num(r.card_id),
    month: String(r.month),
    amount: num(r.amount),
    note: r.note == null ? null : String(r.note),
  }));
}

/** Newest first: the newest `limit`, or every transaction when `limit` is null. */
export async function listTransactions(limit: number | null = 500): Promise<Transaction[]> {
  const db = await getDb();
  const rs = await db.execute({
    sql: "SELECT * FROM transactions ORDER BY date DESC, id DESC LIMIT ?",
    args: [limit ?? -1],
  });
  return rs.rows.map((r) => ({
    id: num(r.id),
    card_id: num(r.card_id),
    date: String(r.date),
    description: String(r.description),
    amount: num(r.amount),
    category: String(r.category),
    is_card_credit: num(r.is_card_credit) === 1,
    benefit_id: r.benefit_id == null ? null : num(r.benefit_id),
    hidden: num(r.hidden) === 1,
  }));
}

export type CardCreditTotals = { total: number; count: number };

/**
 * Card benefit credits redeemed so far this year. Stored as negative amounts
 * (they net against spend), reported here as a positive "how much I've used".
 */
export async function getCardCreditsForYear(
  year: string
): Promise<CardCreditTotals> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
          FROM transactions
          WHERE is_card_credit = 1 AND substr(date, 1, 4) = ?`,
    args: [year],
  });
  const r = rs.rows[0];
  return { total: Math.abs(num(r?.total)), count: num(r?.count) };
}

export type CardBenefit = {
  id: number;
  card_id: number;
  name: string;
  amount: number;
  period: "annual" | "monthly";
  sort_order: number | null;
};

export async function listCardBenefits(): Promise<CardBenefit[]> {
  const db = await getDb();
  const rs = await db.execute(
    "SELECT * FROM card_benefits ORDER BY card_id, sort_order, id"
  );
  return rs.rows.map((r) => ({
    id: num(r.id),
    card_id: num(r.card_id),
    name: String(r.name),
    amount: num(r.amount),
    period: String(r.period) === "monthly" ? "monthly" : "annual",
    sort_order: r.sort_order == null ? null : num(r.sort_order),
  }));
}

export type BenefitProgress = {
  benefit_id: number;
  used: number;
  months_used: number;
};

/** How much of each benefit has been redeemed in the given year. */
export async function getBenefitProgress(
  year: string
): Promise<BenefitProgress[]> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT benefit_id,
                 SUM(ABS(amount)) AS used,
                 COUNT(DISTINCT substr(date, 1, 7)) AS months_used
          FROM transactions
          WHERE is_card_credit = 1
            AND benefit_id IS NOT NULL
            AND substr(date, 1, 4) = ?
          GROUP BY benefit_id`,
    args: [year],
  });
  return rs.rows.map((r) => ({
    benefit_id: num(r.benefit_id),
    used: num(r.used),
    months_used: num(r.months_used),
  }));
}

/** Credits marked but not attributed to any benefit — surfaced as a nudge. */
export async function getUntaggedCardCredits(
  year: string
): Promise<CardCreditTotals> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
          FROM transactions
          WHERE is_card_credit = 1
            AND benefit_id IS NULL
            AND substr(date, 1, 4) = ?`,
    args: [year],
  });
  const r = rs.rows[0];
  return { total: Math.abs(num(r?.total)), count: num(r?.count) };
}

export type MerchantRule = {
  id: number;
  match_key: string;
  category: string;
};

export async function listMerchantRules(): Promise<MerchantRule[]> {
  const db = await getDb();
  const rs = await db.execute("SELECT * FROM merchant_rules ORDER BY match_key");
  return rs.rows.map((r) => ({
    id: num(r.id),
    match_key: String(r.match_key),
    category: String(r.category),
  }));
}

export async function listBudgets(): Promise<Budget[]> {
  const db = await getDb();
  const rs = await db.execute("SELECT * FROM budgets ORDER BY category");
  return rs.rows.map((r) => ({
    id: num(r.id),
    category: String(r.category),
    monthly_limit: num(r.monthly_limit),
  }));
}

/**
 * Total spend per (card, month) preferring imported transactions and falling
 * back to a manually-entered monthly amount — so the two never double-count.
 */
export type Bill = {
  id: number;
  name: string;
  /** The usual monthly amount: pre-fills each month's entry. */
  amount: number;
  start_month: string;
};

/** What one bill actually came to in one month. */
export type BillPayment = { id: number; bill_id: number; month: string; amount: number };

export type HoldingValuePoint = { month: string; holding_id: number; ticker: string; value: number };

/** Each holding's value in the last snapshot of every month, oldest month first. */
export async function getHoldingValueHistory(): Promise<HoldingValuePoint[]> {
  const db = await getDb();
  const rs = await db.execute(
    `SELECT substr(s.date, 1, 7) AS month, sh.holding_id, sh.ticker, sh.value
     FROM snapshot_holdings sh
     JOIN daily_snapshots s ON s.id = sh.snapshot_id
     WHERE s.date IN (SELECT MAX(date) FROM daily_snapshots GROUP BY substr(date, 1, 7))
     ORDER BY month, sh.value DESC`
  );
  return rs.rows.map((r) => ({
    month: String(r.month),
    holding_id: num(r.holding_id),
    ticker: String(r.ticker),
    value: num(r.value),
  }));
}

/** Industry per ticker ("" for funds/ETFs); tickers not looked up yet are absent. */
export async function getTickerIndustries(): Promise<Map<string, string>> {
  const db = await getDb();
  const rs = await db.execute("SELECT ticker, industry FROM ticker_profiles");
  return new Map(rs.rows.map((r) => [String(r.ticker), String(r.industry)]));
}

/** Card charges per day since `from` (YYYY-MM-DD); credits and refunds excluded. */
export async function getDailySpending(
  from: string
): Promise<{ date: string; total: number }[]> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT date, SUM(amount) AS total FROM transactions
          WHERE amount > 0 AND date >= ?
          GROUP BY date ORDER BY date`,
    args: [from],
  });
  return rs.rows.map((r) => ({ date: String(r.date), total: num(r.total) }));
}

export async function listBills(): Promise<Bill[]> {
  const db = await getDb();
  const rs = await db.execute("SELECT * FROM bills ORDER BY amount DESC, name");
  return rs.rows.map((r) => ({
    id: num(r.id),
    name: String(r.name),
    amount: num(r.amount),
    start_month: String(r.start_month),
  }));
}

export async function listBillPayments(): Promise<BillPayment[]> {
  const db = await getDb();
  const rs = await db.execute("SELECT * FROM bill_payments ORDER BY month DESC, bill_id");
  return rs.rows.map((r) => ({
    id: num(r.id),
    bill_id: num(r.bill_id),
    month: String(r.month),
    amount: num(r.amount),
  }));
}

/** Logged bills spending per month. */
async function billMonthTotals(): Promise<Map<string, number>> {
  const db = await getDb();
  const rs = await db.execute(
    "SELECT month, SUM(amount) AS total FROM bill_payments GROUP BY month"
  );
  return new Map(rs.rows.map((r) => [String(r.month), num(r.total)]));
}

async function cardMonthTotals(): Promise<Map<string, number>> {
  const db = await getDb();
  const [tx, manual] = await Promise.all([
    db.execute(
      `SELECT card_id, substr(date, 1, 7) AS month, SUM(amount) AS total
       FROM transactions GROUP BY card_id, month`
    ),
    db.execute("SELECT card_id, month, amount FROM card_payments"),
  ]);
  const totals = new Map<string, number>();
  // Manual first, then let transactions override the same card+month.
  for (const r of manual.rows) {
    totals.set(`${num(r.card_id)}|${String(r.month)}`, num(r.amount));
  }
  for (const r of tx.rows) {
    totals.set(`${num(r.card_id)}|${String(r.month)}`, num(r.total));
  }
  return totals;
}

/** Total spending per month, oldest first (last `limit` months present, or all when null). */
export async function getMonthlySpending(limit: number | null = 12): Promise<MonthlySpending[]> {
  const [totals, bills] = await Promise.all([cardMonthTotals(), billMonthTotals()]);
  const byMonth = new Map<string, number>(bills);
  for (const [key, value] of totals) {
    const month = key.split("|")[1];
    byMonth.set(month, (byMonth.get(month) ?? 0) + value);
  }
  return [...byMonth.entries()]
    .map(([month, total]) => ({ month, total }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(limit == null ? 0 : -limit);
}

/** Per-card spend for a specific month ('YYYY-MM'), from the merged totals. */
export async function getCardSpendForMonth(
  month: string
): Promise<Map<number, number>> {
  const totals = await cardMonthTotals();
  const out = new Map<number, number>();
  for (const [key, value] of totals) {
    const [cardId, m] = key.split("|");
    if (m === month) out.set(Number(cardId), value);
  }
  return out;
}

/** Spend by category for a specific month ('YYYY-MM'), from transactions. */
export type CategorySpendPoint = CategorySpend & { month: string };

/**
 * Category spend for every month that has transactions, so the dashboard can
 * switch months client-side without a refetch.
 */
/** Card spend per card per month (imported transactions, else the manual monthly amount). */
export async function getCardSpendByMonth(): Promise<{ card_id: number; month: string; total: number }[]> {
  const totals = await cardMonthTotals();
  return [...totals.entries()].map(([key, total]) => {
    const [cardId, month] = key.split("|");
    return { card_id: Number(cardId), month, total };
  });
}

/**
 * Card benefit credits get their own category in breakdowns: they reimburse
 * spending elsewhere (hotels, travel…), so filed under whatever the statement
 * called them they'd quietly shrink an unrelated category like Bills.
 */
export const CARD_CREDITS = "Card credits";
const CATEGORY_SQL = `CASE WHEN is_card_credit = 1 THEN '${CARD_CREDITS}' ELSE category END`;

export async function getCategorySpendByMonth(): Promise<CategorySpendPoint[]> {
  const db = await getDb();
  const rs = await db.execute(
    `SELECT substr(date, 1, 7) AS month, ${CATEGORY_SQL} AS category, SUM(amount) AS total
     FROM transactions
     GROUP BY month, 2
     ORDER BY month DESC, total DESC`
  );
  const points = rs.rows.map((r) => ({
    month: String(r.month),
    category: String(r.category),
    total: num(r.total),
  }));
  // Bills count under the "Bills" category, merged with any imported
  // transactions already categorized as Bills.
  for (const [month, total] of await billMonthTotals()) {
    const existing = points.find((p) => p.month === month && p.category === "Bills");
    if (existing) existing.total += total;
    else points.push({ month, category: "Bills", total });
  }
  return points.sort((a, b) => b.month.localeCompare(a.month) || b.total - a.total);
}

export async function getCategorySpendForMonth(
  month: string
): Promise<CategorySpend[]> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT ${CATEGORY_SQL} AS category, SUM(amount) AS total
          FROM transactions
          WHERE substr(date, 1, 7) = ?
          GROUP BY 1
          ORDER BY total DESC`,
    args: [month],
  });
  const spend = rs.rows.map((r) => ({
    category: String(r.category),
    total: num(r.total),
  }));
  const bills = (await billMonthTotals()).get(month) ?? 0;
  if (bills > 0) {
    const existing = spend.find((c) => c.category === "Bills");
    if (existing) existing.total += bills;
    else spend.push({ category: "Bills", total: bills });
  }
  return spend.sort((a, b) => b.total - a.total);
}

/** Monthly-equivalent amount for recurring income; null for one-off/irregular. */
export function monthlyEquivalent(income: IncomeStream): number | null {
  const f = monthlyFactor(income.frequency);
  return f == null ? null : income.amount * f;
}
