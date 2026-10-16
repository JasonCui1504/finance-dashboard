import { NextRequest } from "next/server";
import { badRequest, parseId, requireSession } from "../../../../../lib/finance/api";
import { getDb } from "../../../../../lib/finance/db";
import { normalizeDescription } from "../../../../../lib/finance/categories";
import { categoryLabel, resolveCategoryId } from "../../../../../lib/finance/taxonomy";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, ctx: Ctx) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const id = parseId((await ctx.params).id);
  if (!id) return badRequest("Invalid id");

  const b = await request.json();
  // Store the key through the same normalizer used to match, so an edited key
  // can't be saved in a form that could never match anything.
  const key = normalizeDescription(String(b.match_key ?? ""));
  if (key.length < 2) return badRequest("Match text must be at least 2 characters");
  // null keeps the merchant Uncategorized (overriding the keyword guess).
  const categoryId = await resolveCategoryId(b.category_id);
  if (categoryId === "invalid") return badRequest("Unknown category");

  const db = await getDb();
  const clash = await db.execute({
    sql: "SELECT id FROM merchant_rules WHERE match_key = ? AND id != ?",
    args: [key, id],
  });
  if (clash.rows.length) return badRequest(`A rule for "${key}" already exists`);

  await db.execute({
    sql: "UPDATE merchant_rules SET match_key = ?, category = ?, category_id = ? WHERE id = ?",
    args: [key, await categoryLabel(categoryId), categoryId, id],
  });
  return Response.json({ ok: true });
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const id = parseId((await ctx.params).id);
  if (!id) return badRequest("Invalid id");
  const db = await getDb();
  await db.execute({ sql: "DELETE FROM merchant_rules WHERE id = ?", args: [id] });
  return Response.json({ ok: true });
}
