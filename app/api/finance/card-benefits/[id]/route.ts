import { NextRequest } from "next/server";
import { badRequest, parseId, requireSession } from "../../../../../lib/finance/api";
import { getDb } from "../../../../../lib/finance/db";

type Ctx = { params: Promise<{ id: string }> };

const PERIODS = new Set(["annual", "monthly"]);

export async function PUT(request: NextRequest, ctx: Ctx) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const id = parseId((await ctx.params).id);
  if (!id) return badRequest("Invalid id");

  const b = await request.json();
  const name = String(b.name ?? "").trim().slice(0, 120);
  const amount = Number(b.amount);
  const period = String(b.period ?? "annual");
  if (!name) return badRequest("Name is required");
  if (!Number.isFinite(amount) || amount <= 0) return badRequest("Amount must be positive");
  if (!PERIODS.has(period)) return badRequest("Period must be annual or monthly");

  const db = await getDb();
  await db.execute({
    sql: "UPDATE card_benefits SET name = ?, amount = ?, period = ? WHERE id = ?",
    args: [name, amount, period, id],
  });
  return Response.json({ ok: true });
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const id = parseId((await ctx.params).id);
  if (!id) return badRequest("Invalid id");

  const db = await getDb();
  // Detach the credits first so they stay marked, just unattributed, rather
  // than pointing at a benefit that no longer exists.
  await db.batch(
    [
      { sql: "UPDATE transactions SET benefit_id = NULL WHERE benefit_id = ?", args: [id] },
      { sql: "DELETE FROM card_benefits WHERE id = ?", args: [id] },
    ],
    "write"
  );
  return Response.json({ ok: true });
}
