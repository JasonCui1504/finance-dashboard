import { NextRequest } from "next/server";
import { badRequest, requireSession } from "../../../../lib/finance/api";
import { getDb } from "../../../../lib/finance/db";
import { listCardBenefits } from "../../../../lib/finance/queries";

const PERIODS = new Set(["annual", "monthly"]);

export async function GET(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  return Response.json(await listCardBenefits());
}

export async function POST(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;

  const b = await request.json();
  const cardId = Number(b.card_id);
  const name = String(b.name ?? "").trim().slice(0, 120);
  const amount = Number(b.amount);
  const period = String(b.period ?? "annual");

  if (!Number.isInteger(cardId) || cardId <= 0) return badRequest("card_id is required");
  if (!name) return badRequest("Name is required");
  if (!Number.isFinite(amount) || amount <= 0) return badRequest("Amount must be positive");
  if (!PERIODS.has(period)) return badRequest("Period must be annual or monthly");

  const db = await getDb();
  const card = await db.execute({
    sql: "SELECT id FROM credit_cards WHERE id = ?",
    args: [cardId],
  });
  if (!card.rows.length) return badRequest("Unknown card");

  await db.execute({
    sql: `INSERT INTO card_benefits (card_id, name, amount, period, sort_order)
          VALUES (?, ?, ?, ?, ?)`,
    args: [cardId, name, amount, period, b.sort_order == null ? null : Number(b.sort_order)],
  });
  return Response.json({ ok: true }, { status: 201 });
}
