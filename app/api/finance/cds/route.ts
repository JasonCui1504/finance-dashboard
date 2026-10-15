import { NextRequest } from "next/server";
import { badRequest, requireSession } from "../../../../lib/finance/api";
import { getDb } from "../../../../lib/finance/db";
import { listCds } from "../../../../lib/finance/queries";
import { recomputeSnapshot } from "../../../../lib/finance/snapshot";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  return Response.json(await listCds());
}

export async function POST(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;

  const b = await request.json();
  const principal = Number(b.principal);
  const apy = Number(b.apy);
  if (typeof b.bank_name !== "string" || !b.bank_name.trim()) return badRequest("bank_name is required");
  if (!Number.isFinite(principal) || principal <= 0) return badRequest("principal must be > 0");
  if (!Number.isFinite(apy) || apy < 0) return badRequest("apy must be >= 0");
  if (!DATE_RE.test(b.open_date ?? "")) return badRequest("open_date must be YYYY-MM-DD");
  if (!DATE_RE.test(b.maturity_date ?? "")) return badRequest("maturity_date must be YYYY-MM-DD");

  const db = await getDb();
  const rs = await db.execute({
    sql: `INSERT INTO cds (bank_name, principal, apy, open_date, maturity_date, term_months)
          VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    args: [
      b.bank_name.trim(),
      principal,
      apy,
      b.open_date,
      b.maturity_date,
      b.term_months == null || b.term_months === "" ? null : Number(b.term_months),
    ],
  });
  await recomputeSnapshot();
  return Response.json({ id: Number(rs.rows[0].id) }, { status: 201 });
}
