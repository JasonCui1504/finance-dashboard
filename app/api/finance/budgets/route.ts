import { NextRequest } from "next/server";
import { badRequest, requireSession } from "../../../../lib/finance/api";
import { getDb } from "../../../../lib/finance/db";
import { isCategory } from "../../../../lib/finance/categories";
import { listBudgets } from "../../../../lib/finance/queries";

export async function GET(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  return Response.json(await listBudgets());
}

// Upsert a monthly limit for a category.
export async function POST(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;

  const b = await request.json();
  const limit = Number(b.monthly_limit);
  if (typeof b.category !== "string" || !isCategory(b.category)) {
    return badRequest("Invalid category");
  }
  if (!Number.isFinite(limit) || limit < 0) return badRequest("monthly_limit must be >= 0");

  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO budgets (category, monthly_limit) VALUES (?, ?)
          ON CONFLICT(category) DO UPDATE SET monthly_limit = excluded.monthly_limit`,
    args: [b.category, limit],
  });
  return Response.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const b = await request.json();
  if (typeof b.category !== "string") return badRequest("category is required");
  const db = await getDb();
  await db.execute({ sql: "DELETE FROM budgets WHERE category = ?", args: [b.category] });
  return Response.json({ ok: true });
}
