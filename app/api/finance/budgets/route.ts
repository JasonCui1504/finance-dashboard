import { NextRequest } from "next/server";
import { badRequest, parseId, requireSession } from "../../../../lib/finance/api";
import { getDb } from "../../../../lib/finance/db";
import { listSpendingBudgets, resolveCategoryId } from "../../../../lib/finance/taxonomy";

export async function GET(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  return Response.json(await listSpendingBudgets());
}

// Upsert a monthly limit for a whole group ({ group_id }) or one category
// ({ category_id }).
export async function POST(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;

  const b = await request.json();
  const limit = Number(b.monthly_limit);
  if (!Number.isFinite(limit) || limit < 0) return badRequest("monthly_limit must be >= 0");
  const db = await getDb();

  let column: "group_id" | "category_id";
  let target: number;
  if (b.group_id != null && b.group_id !== "") {
    target = Number(b.group_id);
    const g = await db.execute({ sql: "SELECT id FROM spending_groups WHERE id = ?", args: [target] });
    if (!g.rows.length) return badRequest("Unknown group");
    column = "group_id";
  } else {
    const c = await resolveCategoryId(b.category_id);
    if (c == null || c === "invalid") return badRequest("Pick a group or category");
    target = c;
    column = "category_id";
  }

  const existing = await db.execute({
    sql: `SELECT id FROM spending_budgets WHERE ${column} = ?`,
    args: [target],
  });
  await db.execute(
    existing.rows.length
      ? { sql: "UPDATE spending_budgets SET monthly_limit = ? WHERE id = ?", args: [limit, Number(existing.rows[0].id)] }
      : { sql: `INSERT INTO spending_budgets (${column}, monthly_limit) VALUES (?, ?)`, args: [target, limit] }
  );
  return Response.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const b = await request.json();
  const id = parseId(String(b.id ?? ""));
  if (!id) return badRequest("id is required");
  const db = await getDb();
  await db.execute({ sql: "DELETE FROM spending_budgets WHERE id = ?", args: [id] });
  return Response.json({ ok: true });
}
