import type { Row } from "@libsql/client";
import { UNCATEGORIZED, merchantKey, merchantName } from "./categories";
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
  /** Category name ("Uncategorized" when none). */
  category: string;
  category_id: number | null;
  /** 'user' once picked by hand: re-sorts leave it alone. */
  category_source: string;
  is_card_credit: boolean;
  benefit_id: number | null;
  /** Collapsed out of the Manage list. Deliberately ignored by every total. */
  hidden: boolean;
};

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

export type DashboardWarning = { id: number; text: string };

export async function listDashboardWarnings(): Promise<DashboardWarning[]> {
  const db = await getDb();
  const rs = await db.execute("SELECT id, text FROM dashboard_warnings WHERE dismissed_at IS NULL ORDER BY id");
  return rs.rows.map((r) => ({ id: num(r.id), text: String(r.text) }));
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

export async function getSnapshotHistory(limit = 365): Promise<Snapshot[]> {
  const db = await getDb();
  const rs = await db.execute({
    sql: "SELECT * FROM (SELECT * FROM daily_snapshots ORDER BY date DESC LIMIT ?) ORDER BY date ASC",
    args: [limit],
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

export async function listTransactions(limit = 500): Promise<Transaction[]> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT t.*, c.name AS category_name FROM transactions t
          LEFT JOIN spending_categories c ON c.id = t.category_id
          ORDER BY t.date DESC, t.id DESC LIMIT ?`,
    args: [limit],
  });
  return rs.rows.map((r) => ({
    id: num(r.id),
    card_id: num(r.card_id),
    date: String(r.date),
    description: String(r.description),
    amount: num(r.amount),
    category: r.category_name == null ? "Uncategorized" : String(r.category_name),
    category_id: r.category_id == null ? null : num(r.category_id),
    category_source: String(r.category_source ?? "auto"),
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
  /** Category name ("Uncategorized" when the rule keeps a merchant unsorted). */
  category: string;
  category_id: number | null;
};

export async function listMerchantRules(): Promise<MerchantRule[]> {
  const db = await getDb();
  const rs = await db.execute(
    `SELECT r.id, r.match_key, r.category_id, c.name AS category_name FROM merchant_rules r
     LEFT JOIN spending_categories c ON c.id = r.category_id ORDER BY r.match_key`
  );
  return rs.rows.map((r) => ({
    id: num(r.id),
    match_key: String(r.match_key),
    category: r.category_name == null ? "Uncategorized" : String(r.category_name),
    category_id: r.category_id == null ? null : num(r.category_id),
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
  /** Spending category (a Fixed one by default). */
  category_id: number | null;
};

/** What one bill actually came to in one month. */
export type BillPayment = { id: number; bill_id: number; month: string; amount: number };

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
    category_id: r.category_id == null ? null : num(r.category_id),
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

/** Total spending per month, oldest first (last `limit` months present). */
export async function getMonthlySpending(limit = 12): Promise<MonthlySpending[]> {
  const [totals, bills] = await Promise.all([cardMonthTotals(), billMonthTotals()]);
  const byMonth = new Map<string, number>(bills);
  for (const [key, value] of totals) {
    const month = key.split("|")[1];
    byMonth.set(month, (byMonth.get(month) ?? 0) + value);
  }
  return [...byMonth.entries()]
    .map(([month, total]) => ({ month, total }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-limit);
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
/**
 * Card benefit credits get their own category in breakdowns: they reimburse
 * spending elsewhere (hotels, travel…), so filed under whatever the statement
 * called them they'd quietly shrink an unrelated category like Bills.
 */
export const CARD_CREDITS = "Card credits";

/** Spending labels: by category, or rolled up to its group. */
export type SpendLevel = "category" | "group";

const LABEL_JOIN = `LEFT JOIN spending_categories sc ON sc.id = t.category_id
                    LEFT JOIN spending_groups sg ON sg.id = sc.group_id`;
const labelSql = (level: SpendLevel) =>
  `CASE WHEN t.is_card_credit = 1 THEN '${CARD_CREDITS}'
        ELSE COALESCE(${level === "group" ? "sg.name" : "sc.name"}, '${UNCATEGORIZED}') END`;

/** Logged bills per month, labelled by their category or its group. */
async function billMonthLabels(level: SpendLevel): Promise<{ month: string; label: string; total: number }[]> {
  const db = await getDb();
  const rs = await db.execute(
    `SELECT p.month, COALESCE(${level === "group" ? "sg.name" : "sc.name"}, '${UNCATEGORIZED}') AS label,
            SUM(p.amount) AS total
     FROM bill_payments p
     JOIN bills b ON b.id = p.bill_id
     LEFT JOIN spending_categories sc ON sc.id = b.category_id
     LEFT JOIN spending_groups sg ON sg.id = sc.group_id
     GROUP BY p.month, 2`
  );
  return rs.rows.map((r) => ({ month: String(r.month), label: String(r.label), total: num(r.total) }));
}

/** One day's card activity for one card and category: purchases and returns apart. */
export type SpendDay = {
  date: string;
  card_id: number;
  /** null = Uncategorized. */
  category_id: number | null;
  /** A card benefit credit or points redemption (reimburses, isn't a category). */
  credit: boolean;
  /** Charges (positive). */
  spent: number;
  /** Refunds and statement credits (negative). */
  returned: number;
};

/** Net spending at one merchant on one day, for the top-merchants lists. */
export type MerchantDay = {
  date: string;
  name: string;
  category_id: number | null;
  amount: number;
};

/**
 * Spending known only as a monthly total, counted on the 1st by the range
 * view: a card's manual amount for a month with no imported transactions
 * (they win, as in cardMonthTotals), and logged bills.
 */
export type MonthlySpendAmount = {
  month: string;
  card_id: number | null;
  bill_id: number | null;
  /** The bill's category; null for a card's manual total. */
  category_id: number | null;
  amount: number;
};

/** Everything the date-range spending view needs, in one round trip. */
export async function getSpendingActivity(): Promise<{
  days: SpendDay[];
  merchants: MerchantDay[];
  monthly: MonthlySpendAmount[];
}> {
  const db = await getDb();
  const [tx, manual, bills] = await Promise.all([
    db.execute(
      "SELECT date, card_id, description, amount, category_id, is_card_credit FROM transactions ORDER BY date"
    ),
    db.execute(
      `SELECT p.card_id, p.month, p.amount FROM card_payments p
       WHERE NOT EXISTS (
         SELECT 1 FROM transactions t
         WHERE t.card_id = p.card_id AND substr(t.date, 1, 7) = p.month
       )`
    ),
    db.execute(
      `SELECT p.bill_id, p.month, p.amount, b.category_id
       FROM bill_payments p JOIN bills b ON b.id = p.bill_id`
    ),
  ]);
  const days = new Map<string, SpendDay>();
  const merchants = new Map<string, MerchantDay>();
  for (const r of tx.rows) {
    const date = String(r.date);
    const cardId = num(r.card_id);
    const categoryId = r.category_id == null ? null : num(r.category_id);
    const credit = num(r.is_card_credit) === 1;
    const amount = num(r.amount);
    const dk = `${date}|${cardId}|${categoryId}|${credit}`;
    const d = days.get(dk) ?? { date, card_id: cardId, category_id: categoryId, credit, spent: 0, returned: 0 };
    if (amount > 0) d.spent += amount;
    else d.returned += amount;
    days.set(dk, d);
    if (credit) continue;
    const name = merchantName(merchantKey(String(r.description)) || String(r.description).toLowerCase());
    const mk = `${date}|${name}|${categoryId}`;
    const m = merchants.get(mk) ?? { date, name, category_id: categoryId, amount: 0 };
    m.amount += amount;
    merchants.set(mk, m);
  }
  return {
    days: [...days.values()],
    merchants: [...merchants.values()],
    monthly: [
      ...manual.rows.map((r) => ({
        month: String(r.month),
        card_id: num(r.card_id),
        bill_id: null,
        category_id: null,
        amount: num(r.amount),
      })),
      ...bills.rows.map((r) => ({
        month: String(r.month),
        card_id: null,
        bill_id: num(r.bill_id),
        category_id: r.category_id == null ? null : num(r.category_id),
        amount: num(r.amount),
      })),
    ],
  };
}

/**
 * Spend per month by category (or group), card credits apart and logged bills
 * under their own category, so the Cash flow diagram, insights and the
 * assistant read the same labels as the dashboard.
 */
export async function getCategorySpendByMonth(level: SpendLevel = "category"): Promise<CategorySpendPoint[]> {
  const db = await getDb();
  const rs = await db.execute(
    `SELECT substr(t.date, 1, 7) AS month, ${labelSql(level)} AS category, SUM(t.amount) AS total
     FROM transactions t ${LABEL_JOIN}
     GROUP BY month, 2
     ORDER BY month DESC, total DESC`
  );
  const points = rs.rows.map((r) => ({
    month: String(r.month),
    category: String(r.category),
    total: num(r.total),
  }));
  for (const b of await billMonthLabels(level)) {
    const existing = points.find((p) => p.month === b.month && p.category === b.label);
    if (existing) existing.total += b.total;
    else points.push({ month: b.month, category: b.label, total: b.total });
  }
  return points.sort((a, b) => b.month.localeCompare(a.month) || b.total - a.total);
}

export async function getCategorySpendForMonth(
  month: string,
  level: SpendLevel = "category"
): Promise<CategorySpend[]> {
  return (await getCategorySpendByMonth(level))
    .filter((p) => p.month === month)
    .map(({ category, total }) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

/** A monthly limit named by its category, or its group for a group budget. */
export type Budget = { id: number; category: string; monthly_limit: number };

/**
 * Budgets in the original { category, monthly_limit } shape, for code written
 * against it. A group budget is named by the group ("Fixed").
 */
export async function listBudgets(): Promise<Budget[]> {
  const db = await getDb();
  const rs = await db.execute(
    `SELECT b.id, COALESCE(c.name, g.name) AS name, b.monthly_limit
     FROM spending_budgets b
     LEFT JOIN spending_categories c ON c.id = b.category_id
     LEFT JOIN spending_groups g ON g.id = b.group_id
     ORDER BY name`
  );
  return rs.rows
    .filter((r) => r.name != null)
    .map((r) => ({ id: num(r.id), category: String(r.name), monthly_limit: num(r.monthly_limit) }));
}

/** Monthly-equivalent amount for recurring income; null for one-off/irregular. */
export function monthlyEquivalent(income: IncomeStream): number | null {
  const f = monthlyFactor(income.frequency);
  return f == null ? null : income.amount * f;
}
