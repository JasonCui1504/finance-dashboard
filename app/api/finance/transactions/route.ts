import { NextRequest } from "next/server";
import { badRequest, requireSession } from "../../../../lib/finance/api";
import { getDb } from "../../../../lib/finance/db";
import { isCategory } from "../../../../lib/finance/categories";
import { listTransactions } from "../../../../lib/finance/queries";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  return Response.json(await listTransactions());
}

// Bulk insert (statement import) or a single transaction.
export async function POST(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;

  const b = await request.json();
  const cardId = Number(b.card_id);
  if (!Number.isInteger(cardId) || cardId <= 0) return badRequest("card_id is required");

  const rows: unknown[] = Array.isArray(b.transactions)
    ? b.transactions
    : [b];
  if (rows.length === 0) return badRequest("No transactions provided");
  if (rows.length > 5000) return badRequest("Too many rows in one import (max 5000)");

  const db = await getDb();
  const card = await db.execute({
    sql: "SELECT id FROM credit_cards WHERE id = ?",
    args: [cardId],
  });
  if (!card.rows.length) return badRequest("Unknown card");

  const stmts = [];
  for (const raw of rows) {
    const t = raw as Record<string, unknown>;
    const date = String(t.date ?? "");
    const description = String(t.description ?? "").slice(0, 300);
    const amount = Number(t.amount);
    const category = isCategory(String(t.category)) ? String(t.category) : "Other";
    if (!DATE_RE.test(date)) return badRequest(`Bad date: ${date}`);
    if (!Number.isFinite(amount)) return badRequest("Bad amount");
    // Positive = spend, negative = refund/credit (nets against spend). Zero is a
    // no-op. Declined charges and card payments are filtered out before import.
    if (amount === 0) continue;
    stmts.push({
      sql: `INSERT INTO transactions (card_id, date, description, amount, category)
            VALUES (?, ?, ?, ?, ?)`,
      args: [cardId, date, description, amount, category],
    });
  }
  if (stmts.length === 0) return badRequest("No spend rows to import");
  await db.batch(stmts, "write");
  return Response.json({ ok: true, imported: stmts.length }, { status: 201 });
}

// Bulk hide/unhide. Hiding only collapses a row out of the Manage list —
// no total, budget or category figure reads this column.
export async function PATCH(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;

  const b = await request.json().catch(() => null);
  if (typeof b?.hidden !== "boolean") return badRequest("hidden must be true or false");

  const ids = Array.isArray(b.ids) ? b.ids : null;
  if (!ids || ids.length === 0) return badRequest("No transaction ids given");
  if (ids.length > 5000) return badRequest("Too many rows in one update (max 5000)");

  const clean = ids
    .map((v: unknown) => Number(v))
    .filter((n: number) => Number.isInteger(n) && n > 0);
  if (clean.length === 0) return badRequest("No valid transaction ids given");

  const db = await getDb();
  const rs = await db.execute({
    sql: `UPDATE transactions SET hidden = ? WHERE id IN (${clean.map(() => "?").join(",")})`,
    args: [b.hidden ? 1 : 0, ...clean],
  });
  return Response.json({ ok: true, updated: rs.rowsAffected });
}

// Bulk delete: a list of ids, or every transaction when `all` is set.
// Irreversible — the client confirms before calling this.
export async function DELETE(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;

  const b = await request.json().catch(() => null);
  const db = await getDb();

  if (b?.all === true) {
    const rs = await db.execute("DELETE FROM transactions");
    return Response.json({ ok: true, deleted: rs.rowsAffected });
  }

  const ids = Array.isArray(b?.ids) ? b.ids : null;
  if (!ids || ids.length === 0) return badRequest("No transaction ids given");
  if (ids.length > 5000) return badRequest("Too many rows in one delete (max 5000)");

  const clean = ids
    .map((v: unknown) => Number(v))
    .filter((n: number) => Number.isInteger(n) && n > 0);
  if (clean.length === 0) return badRequest("No valid transaction ids given");

  const rs = await db.execute({
    sql: `DELETE FROM transactions WHERE id IN (${clean.map(() => "?").join(",")})`,
    args: clean,
  });
  return Response.json({ ok: true, deleted: rs.rowsAffected });
}
