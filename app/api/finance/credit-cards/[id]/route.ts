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
  const db = await getDb();
  await db.execute({
    sql: `UPDATE credit_cards SET
            name = COALESCE(?, name),
            issuer = COALESCE(?, issuer)
          WHERE id = ?`,
    args: [
      typeof b.name === "string" && b.name.trim() ? b.name.trim() : null,
      typeof b.issuer === "string" ? b.issuer.trim() : null,
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
  // card_payments cascade via FK, but delete explicitly in case FKs are off.
  await db.execute({ sql: "DELETE FROM card_payments WHERE card_id = ?", args: [id] });
  await db.execute({ sql: "DELETE FROM credit_cards WHERE id = ?", args: [id] });
  return Response.json({ ok: true });
}
