import { NextRequest } from "next/server";
import { badRequest, cleanLabel, parseId, requireSession } from "../../../../../lib/finance/api";
import { getDb } from "../../../../../lib/finance/db";
import { categoryLabel, resolveCategoryId } from "../../../../../lib/finance/taxonomy";

type Ctx = { params: Promise<{ id: string }> };

// Rename ({ name }) and/or move to another group ({ group_id }).
export async function PUT(request: NextRequest, ctx: Ctx) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const id = parseId((await ctx.params).id);
  if (!id) return badRequest("Invalid id");
  const b = await request.json();
  const db = await getDb();
  const exists = await db.execute({ sql: "SELECT id FROM spending_categories WHERE id = ?", args: [id] });
  if (!exists.rows.length) return badRequest("Unknown category");

  if (b.group_id != null) {
    const groupId = Number(b.group_id);
    const g = await db.execute({ sql: "SELECT id FROM spending_groups WHERE id = ?", args: [groupId] });
    if (!g.rows.length) return badRequest("Unknown group");
    await db.execute({ sql: "UPDATE spending_categories SET group_id = ? WHERE id = ?", args: [groupId, id] });
  }
  if (b.name != null) {
    const name = cleanLabel(b.name);
    if (!name) return badRequest("Name must be 1–40 characters");
    try {
      await db.batch(
        [
          { sql: "UPDATE spending_categories SET name = ? WHERE id = ?", args: [name, id] },
          // Keep the text mirror columns in step with the new label.
          { sql: "UPDATE transactions SET category = ? WHERE category_id = ?", args: [name, id] },
          { sql: "UPDATE merchant_rules SET category = ? WHERE category_id = ?", args: [name, id] },
        ],
        "write"
      );
    } catch {
      return badRequest(`"${name}" is already used`);
    }
  }
  return Response.json({ ok: true });
}

// Delete, moving its transactions, rules and bills to { move_to } (null =
// Uncategorized). Budgets on it go with it.
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const id = parseId((await ctx.params).id);
  if (!id) return badRequest("Invalid id");
  const b = await request.json().catch(() => ({}));
  const moveTo = await resolveCategoryId(b?.move_to);
  if (moveTo === "invalid" || moveTo === id) return badRequest("Pick another category to move into");
  const label = await categoryLabel(moveTo);
  const db = await getDb();
  await db.batch(
    [
      { sql: "UPDATE transactions SET category_id = ?, category = ? WHERE category_id = ?", args: [moveTo, label, id] },
      { sql: "UPDATE merchant_rules SET category_id = ?, category = ? WHERE category_id = ?", args: [moveTo, label, id] },
      { sql: "UPDATE bills SET category_id = ? WHERE category_id = ?", args: [moveTo, id] },
      { sql: "DELETE FROM spending_budgets WHERE category_id = ?", args: [id] },
      { sql: "DELETE FROM spending_categories WHERE id = ?", args: [id] },
    ],
    "write"
  );
  return Response.json({ ok: true });
}
