import { NextRequest } from "next/server";
import { badRequest, requireSession } from "../../../../lib/finance/api";
import { getDb } from "../../../../lib/finance/db";
import { listCreditCards } from "../../../../lib/finance/queries";

export async function GET(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  return Response.json(await listCreditCards());
}

export async function POST(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;

  const b = await request.json();
  if (typeof b.name !== "string" || !b.name.trim()) {
    return badRequest("name is required");
  }

  const db = await getDb();
  const rs = await db.execute({
    sql: `INSERT INTO credit_cards (name, issuer) VALUES (?, ?) RETURNING id`,
    args: [b.name.trim(), typeof b.issuer === "string" ? b.issuer.trim() : ""],
  });
  return Response.json({ id: Number(rs.rows[0].id) }, { status: 201 });
}
