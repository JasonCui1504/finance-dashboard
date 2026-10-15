import { NextRequest } from "next/server";
import { badRequest, parseId, requireSession } from "../../../../../lib/finance/api";
import { getDb } from "../../../../../lib/finance/db";
import { isCategory, merchantKey } from "../../../../../lib/finance/categories";

type Ctx = { params: Promise<{ id: string }> };

// Recategorize a single transaction, or mark it as a card benefit credit.
export async function PUT(request: NextRequest, ctx: Ctx) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const id = parseId((await ctx.params).id);
  if (!id) return badRequest("Invalid id");

  const b = await request.json();
  const db = await getDb();

  if (typeof b.is_card_credit === "boolean") {
    // Unmarking a credit drops its benefit attribution too — an ordinary
    // refund has no benefit to count against.
    await db.execute({
      sql: b.is_card_credit
        ? "UPDATE transactions SET is_card_credit = 1 WHERE id = ?"
        : "UPDATE transactions SET is_card_credit = 0, benefit_id = NULL WHERE id = ?",
      args: [id],
    });
    return Response.json({ ok: true });
  }

  if ("benefit_id" in b) {
    const benefitId = b.benefit_id == null ? null : Number(b.benefit_id);
    if (benefitId != null && (!Number.isInteger(benefitId) || benefitId <= 0)) {
      return badRequest("Invalid benefit_id");
    }
    if (benefitId != null) {
      const exists = await db.execute({
        sql: "SELECT id FROM card_benefits WHERE id = ?",
        args: [benefitId],
      });
      if (!exists.rows.length) return badRequest("Unknown benefit");
    }
    await db.execute({
      sql: "UPDATE transactions SET benefit_id = ? WHERE id = ?",
      args: [benefitId, id],
    });
    return Response.json({ ok: true });
  }

  if (typeof b.category !== "string" || !isCategory(b.category)) {
    return badRequest("Invalid category");
  }
  await db.execute({
    sql: "UPDATE transactions SET category = ? WHERE id = ?",
    args: [b.category, id],
  });

  // Recategorizing by hand teaches a rule, so the next import of the same
  // merchant lands correctly without being corrected again.
  const row = await db.execute({
    sql: "SELECT description FROM transactions WHERE id = ?",
    args: [id],
  });
  const key = merchantKey(String(row.rows[0]?.description ?? ""));
  if (key.length >= 2) {
    await db.execute({
      sql: `INSERT INTO merchant_rules (match_key, category) VALUES (?, ?)
            ON CONFLICT (match_key) DO UPDATE SET category = excluded.category`,
      args: [key, b.category],
    });
  }
  return Response.json({ ok: true, learned: key || null });
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const id = parseId((await ctx.params).id);
  if (!id) return badRequest("Invalid id");
  const db = await getDb();
  await db.execute({ sql: "DELETE FROM transactions WHERE id = ?", args: [id] });
  return Response.json({ ok: true });
}
