import { NextRequest } from "next/server";
import { badRequest, cleanLabel, requireSession } from "../../../../lib/finance/api";
import { getDb } from "../../../../lib/finance/db";
import { getTaxonomy } from "../../../../lib/finance/taxonomy";

export async function GET(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  return Response.json(await getTaxonomy());
}

// New category ({ name, group_id }) or new group ({ kind: "group", name }).
export async function POST(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const b = await request.json();
  const name = cleanLabel(b.name);
  if (!name) return badRequest("Name must be 1–40 characters");
  const db = await getDb();
  try {
    if (b.kind === "group") {
      const rs = await db.execute({
        sql: `INSERT INTO spending_groups (name, sort_order)
              VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM spending_groups)) RETURNING id`,
        args: [name],
      });
      return Response.json({ id: Number(rs.rows[0].id) }, { status: 201 });
    }
    const groupId = Number(b.group_id);
    const g = await db.execute({ sql: "SELECT id FROM spending_groups WHERE id = ?", args: [groupId] });
    if (!g.rows.length) return badRequest("Unknown group");
    const rs = await db.execute({
      sql: `INSERT INTO spending_categories (group_id, name, sort_order)
            VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM spending_categories)) RETURNING id`,
      args: [groupId, name],
    });
    return Response.json({ id: Number(rs.rows[0].id) }, { status: 201 });
  } catch {
    return badRequest(`"${name}" is already used`);
  }
}
