import { NextRequest } from "next/server";
import { requireSession } from "../../../../lib/finance/api";
import { getDb } from "../../../../lib/finance/db";

// Seeds demo data (accounts, holdings, CDs, income, 120 days of snapshots)
// so the dashboard can be built and reviewed before any real data exists.
// Dev-only unless FINANCE_ALLOW_SEED=true; wipes existing finance data.
export async function POST(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  if (
    process.env.NODE_ENV === "production" &&
    process.env.FINANCE_ALLOW_SEED !== "true"
  ) {
    return Response.json({ error: "Seeding disabled in production" }, { status: 403 });
  }

  const db = await getDb();
  for (const table of [
    "snapshot_holdings",
    "daily_snapshots",
    "holdings",
    "cds",
    "income_streams",
    "accounts",
    "latest_prices",
    "transactions",
    "card_payments",
    "budgets",
    "credit_cards",
  ]) {
    await db.execute(`DELETE FROM ${table}`);
  }

  await db.batch(
    [
      `INSERT INTO accounts (name, type, institution, last_balance, balance_updated_at, apy) VALUES
        ('Fidelity Roth IRA', 'retirement', 'Fidelity', 31800, datetime('now'), NULL),
        ('Vanguard 401(k)', 'retirement', 'Vanguard', 47200, datetime('now'), NULL),
        ('Chase Checking', 'bank', 'Chase', 8250, datetime('now'), NULL),
        ('Ally Savings', 'bank', 'Ally', 24600, datetime('now'), 3.8)`,
      `INSERT INTO holdings (account_id, ticker, shares, cost_basis, purchase_date, broker) VALUES
        (NULL, 'VOO', 42, 16800, '2023-03-15', 'Robinhood'),
        (NULL, 'AAPL', 55, 8200, '2022-11-02', 'Robinhood'),
        (NULL, 'VTI', 60, 13200, '2023-08-21', 'Schwab'),
        (NULL, 'QQQ', 25, 9100, '2024-01-10', 'Schwab'),
        (NULL, 'MSFT', 18, 6300, '2023-05-30', 'Schwab')`,
      `INSERT INTO cds (bank_name, principal, apy, open_date, maturity_date, term_months) VALUES
        ('Marcus', 15000, 4.85, '2025-01-15', '2026-01-15', 12),
        ('Capital One', 10000, 4.25, '2025-06-01', '2026-12-01', 18),
        ('Discover', 8000, 4.50, '2024-11-20', '2025-11-20', 12)`,
      `INSERT INTO income_streams (source_name, amount, frequency, date_received) VALUES
        ('Salary', 4900, 'biweekly', '2026-09-04'),
        ('Photography bookings', 650, 'irregular', '2026-08-22'),
        ('Interest income', 95, 'monthly', '2026-09-01')`,
      `INSERT INTO latest_prices (ticker, price, prev_close, fetched_at) VALUES
        ('VOO', 528.40, 526.10, datetime('now')),
        ('AAPL', 231.15, 233.80, datetime('now')),
        ('VTI', 289.55, 288.20, datetime('now')),
        ('QQQ', 476.30, 472.90, datetime('now')),
        ('MSFT', 428.70, 427.10, datetime('now'))`,
    ],
    "write"
  );

  // 120 days of plausible history ending today: a gentle upward random walk.
  const days = 120;
  const today = new Date();
  let brokerage = 80_000;
  let bank = 31_500;
  let retirement = 74_000;
  let prevTotal: number | null = null;

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const date = d.toISOString().slice(0, 10);
    brokerage *= 1 + (Math.random() - 0.47) * 0.012;
    bank += (Math.random() - 0.35) * 220;
    retirement *= 1 + (Math.random() - 0.46) * 0.008;
    const cds = 33_000 * Math.pow(1.0455, (days - i) / 365);
    const total = brokerage + bank + cds + retirement;
    const dayChangePct =
      prevTotal != null ? ((total - prevTotal) / prevTotal) * 100 : null;
    prevTotal = total;

    const snap = await db.execute({
      sql: `INSERT INTO daily_snapshots
              (date, total_net_worth, total_brokerage, total_bank, total_cds, total_retirement, day_change_pct, allocation_breakdown)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET total_net_worth = excluded.total_net_worth
            RETURNING id`,
      args: [
        date,
        total,
        brokerage,
        bank,
        cds,
        retirement,
        dayChangePct,
        JSON.stringify({ brokerage, bank, cds, retirement }),
      ],
    });

    if (i === 0) {
      const snapshotId = Number(snap.rows[0].id);
      await db.batch(
        [
          {
            sql: `INSERT INTO snapshot_holdings (snapshot_id, holding_id, ticker, price, value) VALUES
                  (?, 1, 'VOO', 528.40, 22192.80), (?, 2, 'AAPL', 231.15, 12713.25),
                  (?, 3, 'VTI', 289.55, 17373.00), (?, 4, 'QQQ', 476.30, 11907.50),
                  (?, 5, 'MSFT', 428.70, 7716.60)`,
            args: [snapshotId, snapshotId, snapshotId, snapshotId, snapshotId],
          },
        ],
        "write"
      );
    }
  }

  // Credit cards. Older months get a manual monthly total; the most recent 2
  // months get itemized transactions (so the category breakdown + budgets show).
  const cardSpecs = [
    { name: "Chase Sapphire", issuer: "Chase", base: 1800 },
    { name: "Amex Gold", issuer: "American Express", base: 1200 },
    { name: "Apple Card", issuer: "Goldman Sachs", base: 600 },
  ];
  const sampleMerchants: { desc: string; category: string; min: number; max: number }[] = [
    { desc: "WHOLE FOODS MARKET", category: "Groceries", min: 40, max: 180 },
    { desc: "TRADER JOE'S", category: "Groceries", min: 30, max: 120 },
    { desc: "BLUE BOTTLE COFFEE", category: "Dining", min: 6, max: 22 },
    { desc: "CHIPOTLE ONLINE", category: "Dining", min: 12, max: 40 },
    { desc: "UBER TRIP", category: "Transportation", min: 8, max: 45 },
    { desc: "SHELL OIL", category: "Transportation", min: 30, max: 75 },
    { desc: "AMAZON.COM", category: "Shopping", min: 15, max: 220 },
    { desc: "NETFLIX.COM", category: "Subscriptions", min: 16, max: 16 },
    { desc: "SPOTIFY USA", category: "Subscriptions", min: 12, max: 12 },
    { desc: "PG&E ELECTRIC", category: "Utilities", min: 60, max: 160 },
    { desc: "AMC THEATRES", category: "Entertainment", min: 18, max: 55 },
    { desc: "CVS PHARMACY", category: "Health", min: 10, max: 70 },
    { desc: "DELTA AIR LINES", category: "Travel", min: 120, max: 480 },
  ];
  const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

  for (const spec of cardSpecs) {
    const card = await db.execute({
      sql: "INSERT INTO credit_cards (name, issuer) VALUES (?, ?) RETURNING id",
      args: [spec.name, spec.issuer],
    });
    const cardId = Number(card.rows[0].id);
    for (let m = 5; m >= 0; m--) {
      const d = new Date(today.getFullYear(), today.getMonth() - m, 1);
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (m <= 1) {
        // Itemized transactions for the two most recent months.
        const count = 8 + Math.floor(Math.random() * 8);
        const stmts = [];
        for (let k = 0; k < count; k++) {
          const merch = pick(sampleMerchants);
          const day = 1 + Math.floor(Math.random() * 27);
          const date = `${month}-${String(day).padStart(2, "0")}`;
          const amount =
            Math.round((merch.min + Math.random() * (merch.max - merch.min)) * 100) / 100;
          stmts.push({
            sql: `INSERT INTO transactions (card_id, date, description, amount, category)
                  VALUES (?, ?, ?, ?, ?)`,
            args: [cardId, date, merch.desc, amount, merch.category],
          });
        }
        await db.batch(stmts, "write");
      } else {
        const amount = Math.round(spec.base * (0.75 + Math.random() * 0.6));
        await db.execute({
          sql: `INSERT INTO card_payments (card_id, month, amount) VALUES (?, ?, ?)`,
          args: [cardId, month, amount],
        });
      }
    }
  }

  await db.batch(
    [
      `INSERT INTO budgets (category, monthly_limit) VALUES
        ('Groceries', 600), ('Dining', 400), ('Transportation', 250),
        ('Shopping', 500), ('Subscriptions', 80)`,
    ],
    "write"
  );

  return Response.json({ ok: true, seeded: { days } });
}
