import { NextRequest } from "next/server";
import { badRequest, requireSession } from "../../../../lib/finance/api";
import { getDb } from "../../../../lib/finance/db";
import { listIncomeStreams } from "../../../../lib/finance/queries";

const FREQUENCIES = ["paycheck", "one_off", "weekly", "biweekly", "monthly", "irregular"] as const;

export async function GET(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  return Response.json(await listIncomeStreams());
}

export async function POST(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;

  const b = await request.json();
  const amount = Number(b.amount);
  if (typeof b.source_name !== "string" || !b.source_name.trim()) {
    return badRequest("source_name is required");
  }
  if (!Number.isFinite(amount) || amount <= 0) return badRequest("amount must be > 0");
  if (!FREQUENCIES.includes(b.frequency)) {
    return badRequest(`frequency must be one of ${FREQUENCIES.join(", ")}`);
  }

  // Tax is optional; 0 is a meaningful answer (untaxed income), so only an
  // absent or blank value becomes null.
  const rawTax = b.tax_withheld;
  const taxGiven = rawTax != null && rawTax !== "";
  const tax = taxGiven ? Number(rawTax) : null;
  if (tax != null && (!Number.isFinite(tax) || tax < 0)) {
    return badRequest("tax_withheld must be 0 or more");
  }

  const db = await getDb();
  const rs = await db.execute({
    sql: `INSERT INTO income_streams (source_name, amount, frequency, date_received, tax_withheld)
          VALUES (?, ?, ?, ?, ?) RETURNING id`,
    args: [
      b.source_name.trim(),
      amount,
      b.frequency,
      typeof b.date_received === "string" && b.date_received ? b.date_received : null,
      tax,
    ],
  });
  return Response.json({ id: Number(rs.rows[0].id) }, { status: 201 });
}
