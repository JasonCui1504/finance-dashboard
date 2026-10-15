import { NextRequest } from "next/server";
import { badRequest, parseId, requireSession } from "../../../../../lib/finance/api";
import { getDb } from "../../../../../lib/finance/db";
import { recomputeSnapshot } from "../../../../../lib/finance/snapshot";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, ctx: Ctx) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const id = parseId((await ctx.params).id);
  if (!id) return badRequest("Invalid id");

  const b = await request.json();
  const principal = b.principal == null ? null : Number(b.principal);
  const apy = b.apy == null ? null : Number(b.apy);
  if (principal != null && (!Number.isFinite(principal) || principal <= 0)) {
    return badRequest("principal must be > 0");
  }
  if (apy != null && (!Number.isFinite(apy) || apy < 0)) return badRequest("apy must be >= 0");

  const db = await getDb();
  await db.execute({
    sql: `UPDATE cds SET
            bank_name = COALESCE(?, bank_name),
            principal = COALESCE(?, principal),
            apy = COALESCE(?, apy),
            open_date = COALESCE(?, open_date),
            maturity_date = COALESCE(?, maturity_date),
            term_months = COALESCE(?, term_months)
          WHERE id = ?`,
    args: [
      typeof b.bank_name === "string" && b.bank_name.trim() ? b.bank_name.trim() : null,
      principal,
      apy,
      typeof b.open_date === "string" && b.open_date ? b.open_date : null,
      typeof b.maturity_date === "string" && b.maturity_date ? b.maturity_date : null,
      b.term_months == null || b.term_months === "" ? null : Number(b.term_months),
      id,
    ],
  });
  await recomputeSnapshot();
  return Response.json({ ok: true });
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const id = parseId((await ctx.params).id);
  if (!id) return badRequest("Invalid id");
  const db = await getDb();
  await db.execute({ sql: "DELETE FROM cds WHERE id = ?", args: [id] });
  await recomputeSnapshot();
  return Response.json({ ok: true });
}
