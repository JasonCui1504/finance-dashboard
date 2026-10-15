import { NextRequest } from "next/server";
import { badRequest, requireSession } from "../../../../lib/finance/api";
import { getDb } from "../../../../lib/finance/db";
import { listBillPayments } from "../../../../lib/finance/queries";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  return Response.json(await listBillPayments());
}

/**
 * Logs what bills came to for a month (one entry per bill per month; logging
 * again replaces it). Body: { month, entries: [{ bill_id, amount }] }.
 */
export async function POST(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;

  const b = await request.json();
  if (!MONTH_RE.test(b.month ?? "")) return badRequest("month must be YYYY-MM");
  const entries = Array.isArray(b.entries) ? b.entries : [];
  if (entries.length === 0) return badRequest("Nothing to log");
  for (const e of entries) {
    if (!Number.isInteger(Number(e.bill_id)) || Number(e.bill_id) <= 0) return badRequest("bill_id is required");
    const amount = Number(e.amount);
    if (!Number.isFinite(amount) || amount < 0) return badRequest("amount must be 0 or more");
  }

  const db = await getDb();
  const known = await db.execute("SELECT id FROM bills");
  const ids = new Set(known.rows.map((r) => Number(r.id)));
  if (entries.some((e: { bill_id: unknown }) => !ids.has(Number(e.bill_id)))) return badRequest("Unknown bill");

  await db.batch(
    entries.map((e: { bill_id: unknown; amount: unknown }) => ({
      sql: `INSERT INTO bill_payments (bill_id, month, amount) VALUES (?, ?, ?)
            ON CONFLICT(bill_id, month) DO UPDATE SET amount = excluded.amount`,
      args: [Number(e.bill_id), b.month, Number(e.amount)],
    })),
    "write"
  );
  return Response.json({ ok: true }, { status: 201 });
}
