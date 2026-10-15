import { NextRequest } from "next/server";
import { badRequest, requireSession } from "../../../../lib/finance/api";
import {
  getSettings,
  NET_WORTH_CATEGORIES,
  setHiddenCategories,
  type NetWorthCategory,
} from "../../../../lib/finance/queries";

export async function GET(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  return Response.json(await getSettings());
}

export async function POST(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;

  const b = await request.json();
  if (!Array.isArray(b.hidden_categories)) {
    return badRequest("hidden_categories must be an array");
  }
  const valid = new Set<string>(NET_WORTH_CATEGORIES);
  const hidden = b.hidden_categories.filter((c: unknown) => valid.has(String(c)));
  await setHiddenCategories(hidden as NetWorthCategory[]);
  return Response.json({ ok: true });
}
