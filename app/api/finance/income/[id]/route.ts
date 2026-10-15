import { NextRequest } from "next/server";
import { badRequest, parseId, requireSession } from "../../../../../lib/finance/api";
import { getDb } from "../../../../../lib/finance/db";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, ctx: Ctx) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const id = parseId((await ctx.params).id);
  if (!id) return badRequest("Invalid id");

  const b = await request.json();
  const amount = b.amount == null ? null : Number(b.amount);
  if (amount != null && (!Number.isFinite(amount) || amount <= 0)) {
    return badRequest("amount must be > 0");
  }

  const db = await getDb();
  await db.execute({
    sql: `UPDATE income_streams SET
            source_name = COALESCE(?, source_name),
            amount = COALESCE(?, amount),
            frequency = COALESCE(?, frequency),
            date_received = COALESCE(?, date_received)
          WHERE id = ?`,
    args: [
      typeof b.source_name === "string" && b.source_name.trim() ? b.source_name.trim() : null,
      amount,
      typeof b.frequency === "string" && b.frequency ? b.frequency : null,
      typeof b.date_received === "string" && b.date_received ? b.date_received : null,
      id,
    ],
  });

  // Set separately from the COALESCE block above so that clearing the field
  // (null/blank) genuinely clears it rather than being read as "leave as is".
  if ("tax_withheld" in b) {
    const raw = b.tax_withheld;
    const tax = raw == null || raw === "" ? null : Number(raw);
    if (tax != null && (!Number.isFinite(tax) || tax < 0)) {
      return badRequest("tax_withheld must be 0 or more");
    }
    await db.execute({
      sql: "UPDATE income_streams SET tax_withheld = ? WHERE id = ?",
      args: [tax, id],
    });
  }
  return Response.json({ ok: true });
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const id = parseId((await ctx.params).id);
  if (!id) return badRequest("Invalid id");
  const db = await getDb();
  await db.execute({ sql: "DELETE FROM income_streams WHERE id = ?", args: [id] });
  return Response.json({ ok: true });
}
