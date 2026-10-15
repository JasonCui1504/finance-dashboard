import { NextRequest } from "next/server";
import { badRequest, parseId, requireSession } from "../../../../../lib/finance/api";
import { getDb } from "../../../../../lib/finance/db";
import { recomputeSnapshot } from "../../../../../lib/finance/snapshot";

type Ctx = { params: Promise<{ id: string }> };

const TYPES = ["brokerage", "bank", "cd", "retirement"];

export async function PUT(request: NextRequest, ctx: Ctx) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const id = parseId((await ctx.params).id);
  if (!id) return badRequest("Invalid id");

  const b = await request.json();
  const lastBalance = b.last_balance == null ? null : Number(b.last_balance);
  if (lastBalance != null && !Number.isFinite(lastBalance)) {
    return badRequest("last_balance must be a number");
  }
  if (b.type != null && !TYPES.includes(b.type)) {
    return badRequest(`type must be one of ${TYPES.join(", ")}`);
  }
  // apy: undefined = leave alone, null/"" = clear, number = set.
  const apyProvided = "apy" in b;
  const apy = b.apy == null || b.apy === "" ? null : Number(b.apy);
  if (apyProvided && apy != null && (!Number.isFinite(apy) || apy < 0)) {
    return badRequest("apy must be >= 0");
  }

  const db = await getDb();
  await db.execute({
    sql: `UPDATE accounts SET
            name = COALESCE(?, name),
            institution = COALESCE(?, institution),
            type = COALESCE(?, type),
            last_balance = COALESCE(?, last_balance),
            balance_updated_at = CASE WHEN ? IS NULL THEN balance_updated_at ELSE datetime('now') END,
            apy = CASE WHEN ? THEN ? ELSE apy END
          WHERE id = ?`,
    args: [
      typeof b.name === "string" && b.name.trim() ? b.name.trim() : null,
      typeof b.institution === "string" ? b.institution.trim() : null,
      b.type ?? null,
      lastBalance,
      lastBalance,
      apyProvided ? 1 : 0,
      apy,
      id,
    ],
  });
  await recomputeSnapshot();
  return Response.json({ ok: true });
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const id = parseId((await ctx.params).id);
  if (!id) return badRequest("Invalid id");

  const db = await getDb();
  await db.execute({ sql: "DELETE FROM holdings WHERE account_id = ?", args: [id] });
  await db.execute({ sql: "DELETE FROM accounts WHERE id = ?", args: [id] });
  await recomputeSnapshot();
  return Response.json({ ok: true });
}
