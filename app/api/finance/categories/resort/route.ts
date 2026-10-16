import { NextRequest } from "next/server";
import { requireSession } from "../../../../../lib/finance/api";
import { recomputeSnapshot } from "../../../../../lib/finance/snapshot";
import { applyResort, planResort } from "../../../../../lib/finance/resort";

// Preview: where every transaction would land, without changing anything.
export async function GET(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const { report } = await planResort();
  return Response.json(report);
}

// Apply the re-sort (backs the database up first).
export async function POST(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const result = await applyResort();
  await recomputeSnapshot();
  return Response.json(result);
}
