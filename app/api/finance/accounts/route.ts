import { NextRequest } from "next/server";
import { badRequest, requireSession } from "../../../../lib/finance/api";
import { getDb } from "../../../../lib/finance/db";
import { listAccounts } from "../../../../lib/finance/queries";
import { recomputeSnapshot } from "../../../../lib/finance/snapshot";

const TYPES = ["brokerage", "bank", "cd", "retirement"] as const;

export async function GET(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  return Response.json(await listAccounts());
}

export async function POST(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;

  const b = await request.json();
  if (typeof b.name !== "string" || !b.name.trim()) return badRequest("name is required");
  if (!TYPES.includes(b.type)) {
    return badRequest(`type must be one of ${TYPES.join(", ")}`);
  }
  const lastBalance = b.last_balance == null ? null : Number(b.last_balance);
  if (lastBalance != null && !Number.isFinite(lastBalance)) {
    return badRequest("last_balance must be a number");
  }
  const apy = b.apy == null || b.apy === "" ? null : Number(b.apy);
  if (apy != null && (!Number.isFinite(apy) || apy < 0)) {
    return badRequest("apy must be >= 0");
  }

  const db = await getDb();
  const rs = await db.execute({
    sql: `INSERT INTO accounts (name, type, institution, last_balance, balance_updated_at, apy)
          VALUES (?, ?, ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END, ?)
          RETURNING id`,
    args: [
      b.name.trim(),
      b.type,
      typeof b.institution === "string" ? b.institution.trim() : "",
      lastBalance,
      lastBalance,
      apy,
    ],
  });
  await recomputeSnapshot();
  return Response.json({ id: Number(rs.rows[0].id) }, { status: 201 });
}
