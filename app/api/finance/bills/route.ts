import { NextRequest } from "next/server";
import { badRequest, requireSession } from "../../../../lib/finance/api";
import { getDb } from "../../../../lib/finance/db";
import { listBills } from "../../../../lib/finance/queries";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  return Response.json(await listBills());
}

export async function POST(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;

  const b = await request.json();
  const amount = Number(b.amount);
  if (typeof b.name !== "string" || !b.name.trim()) return badRequest("name is required");
  if (!Number.isFinite(amount) || amount <= 0) return badRequest("amount must be > 0");
  // Kept for older rows; bills no longer count by start month, only by what's logged.
  const startMonth = typeof b.start_month === "string" && MONTH.test(b.start_month) ? b.start_month : new Date().toISOString().slice(0, 7);

  const db = await getDb();
  const rs = await db.execute({
    sql: "INSERT INTO bills (name, amount, start_month) VALUES (?, ?, ?) RETURNING id",
    args: [b.name.trim(), amount, startMonth],
  });
  return Response.json({ id: Number(rs.rows[0].id) }, { status: 201 });
}
