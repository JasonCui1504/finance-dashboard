import { NextRequest } from "next/server";
import { badRequest, parseId, requireSession } from "../../../../../lib/finance/api";
import { getDb } from "../../../../../lib/finance/db";
import { recomputeSnapshot } from "../../../../../lib/finance/snapshot";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, ctx: Ctx) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const id = parseId((await ctx.params).id);
  if (!id) return badRequest("Invalid id");

  const b = await request.json();
  const shares = b.shares == null ? null : Number(b.shares);
  if (shares != null && (!Number.isFinite(shares) || shares <= 0)) {
    return badRequest("shares must be > 0");
  }
  // manual_price / broker: absent = leave alone; null/"" = clear; value = set.
  const manualProvided = "manual_price" in b;
  const manualPrice =
    b.manual_price == null || b.manual_price === "" ? null : Number(b.manual_price);
  if (manualProvided && manualPrice != null && (!Number.isFinite(manualPrice) || manualPrice < 0)) {
    return badRequest("Invalid manual price");
  }
  const brokerProvided = "broker" in b;
  const broker =
    typeof b.broker === "string" && b.broker.trim() ? b.broker.trim().slice(0, 40) : null;

  const db = await getDb();
  await db.execute({
    sql: `UPDATE holdings SET
            shares = COALESCE(?, shares),
            manual_price = CASE WHEN ? THEN ? ELSE manual_price END,
            broker = CASE WHEN ? THEN ? ELSE broker END
          WHERE id = ?`,
    args: [shares, manualProvided ? 1 : 0, manualPrice, brokerProvided ? 1 : 0, broker, id],
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
  await db.execute({ sql: "DELETE FROM holdings WHERE id = ?", args: [id] });
  await recomputeSnapshot();
  return Response.json({ ok: true });
}
