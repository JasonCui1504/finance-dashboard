import { NextRequest } from "next/server";
import { badRequest, parseId, requireSession } from "../../../../../lib/finance/api";
import { getDb } from "../../../../../lib/finance/db";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const id = parseId((await ctx.params).id);
  if (!id) return badRequest("Invalid id");
  const db = await getDb();
  await db.execute({ sql: "DELETE FROM bill_payments WHERE id = ?", args: [id] });
  return Response.json({ ok: true });
}
