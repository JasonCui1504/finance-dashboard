import { createClient, type Client } from "@libsql/client";
import {
  DEFAULT_CATEGORIES,
  DEFAULT_GROUPS,
  categorizeSlug,
  legacySlug,
} from "./categories";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";

// Local dev uses a SQLite file (gitignored). Production points FINANCE_DATABASE_URL
// at a Turso/libSQL database, since Vercel's filesystem doesn't persist.
const DEFAULT_URL = "file:.data/finance.db";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('brokerage','bank','cd','retirement')),
    institution TEXT NOT NULL DEFAULT '',
    last_balance REAL,
    balance_updated_at TEXT,
    apy REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER,
    ticker TEXT NOT NULL,
    shares REAL NOT NULL,
    cost_basis REAL,
    purchase_date TEXT,
    manual_price REAL,
    broker TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS cds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bank_name TEXT NOT NULL,
    principal REAL NOT NULL,
    apy REAL NOT NULL,
    open_date TEXT NOT NULL,
    maturity_date TEXT NOT NULL,
    term_months INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS income_streams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_name TEXT NOT NULL,
    amount REAL NOT NULL,
    frequency TEXT NOT NULL CHECK (frequency IN ('paycheck','one_off','weekly','biweekly','monthly','irregular')),
    date_received TEXT,
    tax_withheld REAL
  )`,
  `CREATE TABLE IF NOT EXISTS daily_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    total_net_worth REAL NOT NULL,
    total_brokerage REAL NOT NULL,
    total_bank REAL NOT NULL,
    total_cds REAL NOT NULL,
    total_retirement REAL NOT NULL DEFAULT 0,
    day_change_pct REAL,
    allocation_breakdown TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS snapshot_holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES daily_snapshots(id) ON DELETE CASCADE,
    holding_id INTEGER NOT NULL,
    ticker TEXT NOT NULL,
    price REAL NOT NULL,
    value REAL NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS latest_prices (
    ticker TEXT PRIMARY KEY,
    price REAL NOT NULL,
    prev_close REAL,
    fetched_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ticker_profiles (
    ticker TEXT PRIMARY KEY,
    industry TEXT NOT NULL DEFAULT '',
    fetched_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS credit_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    issuer TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    amount REAL NOT NULL,
    start_month TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS card_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    amount REAL NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (card_id, month)
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    category TEXT NOT NULL DEFAULT 'Other',
    is_card_credit INTEGER NOT NULL DEFAULT 0,
    benefit_id INTEGER,
    hidden INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS card_benefits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    amount REAL NOT NULL,
    period TEXT NOT NULL DEFAULT 'annual' CHECK (period IN ('annual','monthly')),
    sort_order INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_card_date
     ON transactions (card_id, date)`,
  `CREATE TABLE IF NOT EXISTS merchant_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_key TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL UNIQUE,
    monthly_limit REAL NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  // Notes pinned to the top of the dashboard until dismissed (e.g. "cost basis
  // unknown for ORCL"), added by scripts/local/import-positions.mjs. Dismissed
  // rows are kept so re-importing the same file doesn't bring them back.
  `CREATE TABLE IF NOT EXISTS dashboard_warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    dismissed_at TEXT
  )`,
  // Spending groups (Fixed, Essentials, …) and the categories inside them.
  // Names are yours to edit; slug ties a built-in one to the keyword rules.
  `CREATE TABLE IF NOT EXISTS spending_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS spending_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES spending_groups(id),
    slug TEXT UNIQUE,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,
  // A monthly limit on a whole group or on one category (exactly one is set).
  `CREATE TABLE IF NOT EXISTS spending_budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER REFERENCES spending_groups(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES spending_categories(id) ON DELETE CASCADE,
    monthly_limit REAL NOT NULL,
    CHECK ((group_id IS NULL) != (category_id IS NULL))
  )`,
  // What each bill actually came to in a given month (one entry per bill per month).
  `CREATE TABLE IF NOT EXISTS bill_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    amount REAL NOT NULL,
    UNIQUE (bill_id, month)
  )`,
];

type GlobalWithDb = typeof globalThis & {
  __financeDb?: { client: Client; migrated: Promise<void> };
};

function init(): { client: Client; migrated: Promise<void> } {
  const g = globalThis as GlobalWithDb;
  if (g.__financeDb) return g.__financeDb;

  const url = process.env.FINANCE_DATABASE_URL ?? DEFAULT_URL;
  if (url.startsWith("file:")) {
    mkdirSync(dirname(resolve(url.slice("file:".length))), { recursive: true });
  }
  const client = createClient({
    url,
    authToken: process.env.FINANCE_DATABASE_AUTH_TOKEN,
  });
  const migrated = client
    .batch(SCHEMA, "write")
    .then(() => migrate(client))
    .then(() => undefined);
  g.__financeDb = { client, migrated };
  return g.__financeDb;
}

/** Upgrades databases created before newer columns/types existed. */
async function migrate(client: Client): Promise<void> {
  const master = await client.execute(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('accounts', 'daily_snapshots', 'transactions', 'income_streams')"
  );
  const tableSql = new Map(
    master.rows.map((r) => [String(r.name), String(r.sql ?? "")])
  );

  const accountsSql = tableSql.get("accounts") ?? "";
  // Rebuild the accounts table to drop the legacy Plaid columns / source
  // (and, for very old databases, to widen the type CHECK and add apy).
  if (
    accountsSql &&
    (accountsSql.includes("plaid_item_id") || !accountsSql.includes("'retirement'"))
  ) {
    const hasApy = /\bapy\b/.test(accountsSql);
    await client.batch(
      [
        `CREATE TABLE accounts_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('brokerage','bank','cd','retirement')),
          institution TEXT NOT NULL DEFAULT '',
          last_balance REAL,
          balance_updated_at TEXT,
          apy REAL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
        `INSERT INTO accounts_new
           (id, name, type, institution, last_balance, balance_updated_at, apy, created_at)
         SELECT id, name, type, institution, last_balance, balance_updated_at, ${
           hasApy ? "apy" : "NULL"
         }, created_at
         FROM accounts`,
        "DROP TABLE accounts",
        "ALTER TABLE accounts_new RENAME TO accounts",
      ],
      "write"
    );
  } else if (accountsSql && !/\bapy\b/.test(accountsSql)) {
    await client.execute("ALTER TABLE accounts ADD COLUMN apy REAL");
  }

  // Legacy Plaid table, no longer used.
  await client.execute("DROP TABLE IF EXISTS plaid_items");

  // Manual price fallback for tickers with no live quote (e.g. OTC).
  const holdingsRow = await client.execute(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'holdings'"
  );
  const holdingsSql = String(holdingsRow.rows[0]?.sql ?? "");
  if (holdingsSql && !/\bmanual_price\b/.test(holdingsSql)) {
    await client.execute("ALTER TABLE holdings ADD COLUMN manual_price REAL");
  }
  if (holdingsSql && !/\bbroker\b/.test(holdingsSql)) {
    await client.execute("ALTER TABLE holdings ADD COLUMN broker TEXT");
  }

  // Marks a credit as a card benefit / points redemption rather than an
  // ordinary merchant refund, so redeemed credits can be totalled separately.
  const transactionsSql = tableSql.get("transactions") ?? "";
  if (transactionsSql && !/\bis_card_credit\b/.test(transactionsSql)) {
    await client.execute(
      "ALTER TABLE transactions ADD COLUMN is_card_credit INTEGER NOT NULL DEFAULT 0"
    );
  }
  // Which card benefit a redeemed credit counts against.
  if (transactionsSql && !/\bbenefit_id\b/.test(transactionsSql)) {
    await client.execute("ALTER TABLE transactions ADD COLUMN benefit_id INTEGER");
  }
  // Collapses a row out of the Manage list only; totals are unaffected.
  if (transactionsSql && !/\bhidden\b/.test(transactionsSql)) {
    await client.execute(
      "ALTER TABLE transactions ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0"
    );
  }

  // Tax withheld from each income stream, for the effective-rate section.
  const incomeSql = tableSql.get("income_streams") ?? "";
  if (incomeSql && !/\btax_withheld\b/.test(incomeSql)) {
    await client.execute("ALTER TABLE income_streams ADD COLUMN tax_withheld REAL");
  }
  // Rebuild to widen the frequency CHECK for logged paychecks.
  if (incomeSql && !incomeSql.includes("'paycheck'")) {
    await client.batch(
      [
        `CREATE TABLE income_streams_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_name TEXT NOT NULL,
          amount REAL NOT NULL,
          frequency TEXT NOT NULL CHECK (frequency IN ('paycheck','one_off','weekly','biweekly','monthly','irregular')),
          date_received TEXT,
          tax_withheld REAL
        )`,
        `INSERT INTO income_streams_new
           (id, source_name, amount, frequency, date_received, tax_withheld)
         SELECT id, source_name, amount, frequency, date_received, tax_withheld
         FROM income_streams`,
        "DROP TABLE income_streams",
        "ALTER TABLE income_streams_new RENAME TO income_streams",
      ],
      "write"
    );
  }

  const snapshotsSql = tableSql.get("daily_snapshots") ?? "";
  if (snapshotsSql && !snapshotsSql.includes("total_retirement")) {
    await client.execute(
      "ALTER TABLE daily_snapshots ADD COLUMN total_retirement REAL NOT NULL DEFAULT 0"
    );
  }

  await migrateSpendingCategories(client);

  // Bills used to repeat a fixed amount every month from their start month.
  // They're now logged month by month, so (once) turn that implied history
  // into logged entries, keeping past spending totals exactly as they were.
  const flag = await client.execute(
    "SELECT value FROM settings WHERE key = 'bill_payments_backfilled'"
  );
  if (!flag.rows.length) {
    const bills = await client.execute("SELECT id, amount, start_month FROM bills");
    const current = new Date().toISOString().slice(0, 7);
    const stmts: { sql: string; args: (string | number)[] }[] = [];
    for (const b of bills.rows) {
      let [y, m] = String(b.start_month).split("-").map(Number);
      for (let month = String(b.start_month); month <= current; ) {
        stmts.push({
          sql: "INSERT OR IGNORE INTO bill_payments (bill_id, month, amount) VALUES (?, ?, ?)",
          args: [Number(b.id), month, Number(b.amount)],
        });
        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
        month = `${y}-${String(m).padStart(2, "0")}`;
      }
    }
    stmts.push({
      sql: "INSERT INTO settings (key, value) VALUES ('bill_payments_backfilled', '1')",
      args: [],
    });
    await client.batch(stmts, "write");
  }
}

async function hasColumn(client: Client, table: string, column: string): Promise<boolean> {
  const rs = await client.execute(`PRAGMA table_info(${table})`);
  return rs.rows.some((r) => String(r.name) === column);
}

/**
 * The move from six flat categories to groups + categories (once): seed the
 * built-in labels, add the id columns, and carry rules, budgets and bills
 * over. Existing transactions are NOT re-sorted here — that's previewed and
 * applied from Manage → Spending → Categories, so nothing moves unseen.
 */
async function migrateSpendingCategories(client: Client): Promise<void> {
  // Columns first, every start, so a half-finished run can't leave them out.
  const columns: [string, string, string][] = [
    ["transactions", "category_id", "INTEGER"],
    // 'user' once you pick a category by hand; re-sorts never override it.
    ["transactions", "category_source", "TEXT NOT NULL DEFAULT 'auto'"],
    // The issuer's own label from the statement, kept for later re-sorts.
    ["transactions", "issuer_category", "TEXT"],
    ["merchant_rules", "category_id", "INTEGER"],
    ["bills", "category_id", "INTEGER"],
  ];
  for (const [table, column, type] of columns) {
    if (!(await hasColumn(client, table, column))) {
      await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }

  const done = await client.execute(
    "SELECT value FROM settings WHERE key = 'spending_categories_v2'"
  );
  if (done.rows.length) return;

  const stmts: { sql: string; args: (string | number | null)[] }[] = [];
  DEFAULT_GROUPS.forEach((g, i) =>
    stmts.push({
      sql: "INSERT OR IGNORE INTO spending_groups (slug, name, sort_order) VALUES (?, ?, ?)",
      args: [g.slug, g.name, i],
    })
  );
  DEFAULT_CATEGORIES.forEach((c, i) =>
    stmts.push({
      sql: `INSERT OR IGNORE INTO spending_categories (group_id, slug, name, sort_order)
            SELECT id, ?, ?, ? FROM spending_groups WHERE slug = ?`,
      args: [c.slug, c.name, i, c.group],
    })
  );
  await client.batch(stmts, "write");

  const cats = await client.execute("SELECT id, slug, name FROM spending_categories");
  const idBySlug = new Map(cats.rows.map((r) => [String(r.slug), Number(r.id)]));
  const nameById = new Map(cats.rows.map((r) => [Number(r.id), String(r.name)]));
  const groups = await client.execute("SELECT id, slug FROM spending_groups");
  const groupBySlug = new Map(groups.rows.map((r) => [String(r.slug), Number(r.id)]));
  const fixedSlugs = new Set(
    DEFAULT_CATEGORIES.filter((c) => c.group === "fixed").map((c) => c.slug as string)
  );
  const travelish = new Set(["flights", "lodging", "car_rental", "trip_extras", "getting_around"]);

  const out: { sql: string; args: (string | number | null)[] }[] = [];

  // Rules you taught: keep their intent, refined where the old label was broad.
  const rules = await client.execute("SELECT id, match_key, category FROM merchant_rules");
  for (const r of rules.rows) {
    const old = String(r.category);
    const guess = categorizeSlug(String(r.match_key));
    let slug: string | null = legacySlug(old);
    if (old === "Transport") slug = guess && travelish.has(guess) ? guess : "getting_around";
    if (old === "Bills") slug = guess && fixedSlugs.has(guess) ? guess : "subscriptions";
    const id = slug ? (idBySlug.get(slug) ?? null) : null;
    out.push({
      sql: "UPDATE merchant_rules SET category_id = ?, category = ? WHERE id = ?",
      args: [id, id != null ? nameById.get(id)! : "Uncategorized", Number(r.id)],
    });
  }

  // Budgets: the four labels that map cleanly; Bills becomes the Fixed group.
  const budgets = await client.execute("SELECT category, monthly_limit FROM budgets");
  for (const b of budgets.rows) {
    const old = String(b.category);
    const limit = Number(b.monthly_limit);
    if (old === "Bills") {
      out.push({
        sql: "INSERT INTO spending_budgets (group_id, monthly_limit) VALUES (?, ?)",
        args: [groupBySlug.get("fixed")!, limit],
      });
      continue;
    }
    const slug = legacySlug(old);
    if (!slug) continue;
    out.push({
      sql: "INSERT INTO spending_budgets (category_id, monthly_limit) VALUES (?, ?)",
      args: [idBySlug.get(slug)!, limit],
    });
  }

  // Bills are fixed costs: guess Housing / Utilities / Insurance / Subscriptions
  // from the name, defaulting to Utilities & phone.
  const bills = await client.execute("SELECT id, name FROM bills");
  for (const b of bills.rows) {
    const guess = categorizeSlug(String(b.name));
    const slug = guess && fixedSlugs.has(guess) ? guess : "utilities";
    out.push({
      sql: "UPDATE bills SET category_id = ? WHERE id = ?",
      args: [idBySlug.get(slug)!, Number(b.id)],
    });
  }

  // Point the owner at the one-time re-sort of past transactions.
  const anyTx = await client.execute("SELECT 1 FROM transactions LIMIT 1");
  if (anyTx.rows.length) {
    out.push({
      sql: "INSERT OR IGNORE INTO dashboard_warnings (text) VALUES (?)",
      args: [
        "Spending now uses Fixed / Essentials / Travel / Lifestyle. Your past transactions " +
          "haven't been sorted yet: review and apply the re-sort under Manage → Categories.",
      ],
    });
  }
  out.push({
    sql: "INSERT INTO settings (key, value) VALUES ('spending_categories_v2', '1')",
    args: [],
  });
  await client.batch(out, "write");
}

/** Returns the shared libSQL client, with the schema guaranteed to exist. */
export async function getDb(): Promise<Client> {
  const { client, migrated } = init();
  await migrated;
  return client;
}
