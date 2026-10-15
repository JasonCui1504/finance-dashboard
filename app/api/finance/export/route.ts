import { NextRequest } from "next/server";
import { requireSession } from "../../../../lib/finance/api";
import { getDb } from "../../../../lib/finance/db";

// CSV export of any finance table, for backup / spreadsheets / taxes.
// GET /api/finance/export?type=holdings  (auth via session cookie)

const QUERIES: Record<string, { sql: string; filename: string }> = {
  snapshots: {
    sql: `SELECT date, total_net_worth, total_brokerage, total_bank, total_cds,
            total_retirement, day_change_pct
          FROM daily_snapshots ORDER BY date`,
    filename: "net-worth-history.csv",
  },
  accounts: {
    sql: `SELECT name, type, institution, last_balance, apy, balance_updated_at
          FROM accounts ORDER BY type, name`,
    filename: "accounts.csv",
  },
  holdings: {
    sql: `SELECT ticker, shares, cost_basis, purchase_date, account_id
          FROM holdings ORDER BY ticker`,
    filename: "holdings.csv",
  },
  cds: {
    sql: `SELECT bank_name, principal, apy, open_date, maturity_date, term_months
          FROM cds ORDER BY maturity_date`,
    filename: "cds.csv",
  },
  income: {
    sql: `SELECT source_name, amount, frequency, date_received
          FROM income_streams ORDER BY date_received DESC`,
    filename: "income.csv",
  },
  transactions: {
    sql: `SELECT t.date, c.name AS card, t.description, t.amount, t.category
          FROM transactions t
          LEFT JOIN credit_cards c ON c.id = t.card_id
          ORDER BY t.date DESC`,
    filename: "transactions.csv",
  },
};

function csvCell(value: unknown): string {
  if (value == null) return "";
  const s = typeof value === "bigint" ? String(value) : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;

  const type = request.nextUrl.searchParams.get("type") ?? "";
  const spec = QUERIES[type];
  if (!spec) {
    return Response.json(
      { error: `Unknown type. Use one of: ${Object.keys(QUERIES).join(", ")}` },
      { status: 400 }
    );
  }

  const db = await getDb();
  const rs = await db.execute(spec.sql);
  const header = rs.columns ?? [];
  const lines = [header.map(csvCell).join(",")];
  for (const row of rs.rows) {
    lines.push(header.map((col) => csvCell((row as Record<string, unknown>)[col])).join(","));
  }
  const csv = lines.join("\r\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${spec.filename}"`,
    },
  });
}
