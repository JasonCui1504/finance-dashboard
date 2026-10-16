import { NextRequest } from "next/server";
import { badRequest, cleanLabel, parseId, requireSession } from "../../../../../lib/finance/api";
import { getDb } from "../../../../../lib/finance/db";

type Ctx = { params: Promise<{ id: string }> };

// Rename a group.
export async function PUT(request: NextRequest, ctx: Ctx) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const id = parseId((await ctx.params).id);
  if (!id) return badRequest("Invalid id");
  const name = cleanLabel((await request.json()).name);
  if (!name) return badRequest("Name must be 1–40 characters");
  const db = await getDb();
  try {
    await db.execute({ sql: "UPDATE spending_groups SET name = ? WHERE id = ?", args: [name, id] });
  } catch {
    return badRequest(`"${name}" is already used`);
  }
  return Response.json({ ok: true });
}

// Delete an empty group (move or delete its categories first).
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const id = parseId((await ctx.params).id);
  if (!id) return badRequest("Invalid id");
  const db = await getDb();
  const inUse = await db.execute({ sql: "SELECT 1 FROM spending_categories WHERE group_id = ? LIMIT 1", args: [id] });
  if (inUse.rows.length) return badRequest("Move or delete its categories first");
  await db.batch(
    [
      { sql: "DELETE FROM spending_budgets WHERE group_id = ?", args: [id] },
      { sql: "DELETE FROM spending_groups WHERE id = ?", args: [id] },
    ],
    "write"
  );
  return Response.json({ ok: true });
}
