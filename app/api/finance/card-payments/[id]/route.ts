import { NextRequest } from "next/server";
import { badRequest, parseId, requireSession } from "../../../../../lib/finance/api";
import { getDb } from "../../../../../lib/finance/db";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, ctx: Ctx) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const id = parseId((await ctx.params).id);
  if (!id) return badRequest("Invalid id");

  const b = await request.json();
  const amount = b.amount == null ? null : Number(b.amount);
  if (amount != null && (!Number.isFinite(amount) || amount < 0)) {
    return badRequest("amount must be >= 0");
  }

  const db = await getDb();
  await db.execute({
    sql: `UPDATE card_payments SET
            amount = COALESCE(?, amount),
            note = COALESCE(?, note)
          WHERE id = ?`,
    args: [
      amount,
      typeof b.note === "string" ? b.note.trim() : null,
      id,
    ],
  });
  return Response.json({ ok: true });
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const id = parseId((await ctx.params).id);
  if (!id) return badRequest("Invalid id");
  const db = await getDb();
  await db.execute({ sql: "DELETE FROM card_payments WHERE id = ?", args: [id] });
  return Response.json({ ok: true });
}
