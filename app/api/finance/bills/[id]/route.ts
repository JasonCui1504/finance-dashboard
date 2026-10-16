import { NextRequest } from "next/server";
import { badRequest, parseId, requireSession } from "../../../../../lib/finance/api";
import { getDb } from "../../../../../lib/finance/db";
import { resolveCategoryId } from "../../../../../lib/finance/taxonomy";

type Ctx = { params: Promise<{ id: string }> };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function PUT(request: NextRequest, ctx: Ctx) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const id = parseId((await ctx.params).id);
  if (!id) return badRequest("Invalid id");

  const b = await request.json();
  const amount = b.amount == null ? null : Number(b.amount);
  if (amount != null && (!Number.isFinite(amount) || amount <= 0)) {
    return badRequest("amount must be > 0");
  }
  if (b.start_month != null && (typeof b.start_month !== "string" || !MONTH.test(b.start_month))) {
    return badRequest("start_month must be YYYY-MM");
  }

  const db = await getDb();
  if ("category_id" in b) {
    const cat = await resolveCategoryId(b.category_id);
    if (cat === "invalid") return badRequest("Unknown category");
    await db.execute({ sql: "UPDATE bills SET category_id = ? WHERE id = ?", args: [cat, id] });
  }
  await db.execute({
    sql: `UPDATE bills SET
            name = COALESCE(?, name),
            amount = COALESCE(?, amount),
            start_month = COALESCE(?, start_month)
          WHERE id = ?`,
    args: [
      typeof b.name === "string" && b.name.trim() ? b.name.trim() : null,
      amount,
      b.start_month ?? null,
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
  await db.batch(
    [
      { sql: "DELETE FROM bill_payments WHERE bill_id = ?", args: [id] },
      { sql: "DELETE FROM bills WHERE id = ?", args: [id] },
    ],
    "write"
  );
  return Response.json({ ok: true });
}
