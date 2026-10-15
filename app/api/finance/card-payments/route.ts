import { NextRequest } from "next/server";
import { badRequest, requireSession } from "../../../../lib/finance/api";
import { getDb } from "../../../../lib/finance/db";
import { listCardPayments } from "../../../../lib/finance/queries";

const MONTH_RE = /^\d{4}-\d{2}$/;

export async function GET(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  return Response.json(await listCardPayments());
}

// Upserts a card's spend for a given month (one entry per card per month).
export async function POST(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;

  const b = await request.json();
  const cardId = Number(b.card_id);
  const amount = Number(b.amount);
  if (!Number.isInteger(cardId) || cardId <= 0) return badRequest("card_id is required");
  if (!MONTH_RE.test(b.month ?? "")) return badRequest("month must be YYYY-MM");
  if (!Number.isFinite(amount) || amount < 0) return badRequest("amount must be >= 0");

  const db = await getDb();
  const card = await db.execute({
    sql: "SELECT id FROM credit_cards WHERE id = ?",
    args: [cardId],
  });
  if (!card.rows.length) return badRequest("Unknown card");

  const rs = await db.execute({
    sql: `INSERT INTO card_payments (card_id, month, amount, note)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(card_id, month) DO UPDATE SET
            amount = excluded.amount,
            note = excluded.note
          RETURNING id`,
    args: [cardId, b.month, amount, typeof b.note === "string" ? b.note.trim() : null],
  });
  return Response.json({ id: Number(rs.rows[0].id) }, { status: 201 });
}
