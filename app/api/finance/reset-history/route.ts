import { NextRequest } from "next/server";
import { requireSession } from "../../../../lib/finance/api";
import { getDb } from "../../../../lib/finance/db";
import { recomputeSnapshot } from "../../../../lib/finance/snapshot";

// Wipes the net-worth time-series (daily_snapshots + snapshot_holdings) and
// writes a single fresh snapshot for today. Your accounts, holdings, CDs,
// cards, income, and budgets are untouched — only the historical chart data
// is reset. Useful after back-filling data over several days produced a
// misleading one-day jump.
export async function POST(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;

  const db = await getDb();
  // snapshot_holdings references daily_snapshots; delete children first in case
  // foreign-key cascades aren't enforced.
  await db.execute("DELETE FROM snapshot_holdings");
  await db.execute("DELETE FROM daily_snapshots");

  // Recompute today's snapshot from current balances/holdings/CDs. With no
  // prior rows, day_change_pct comes back null (no fake day-over-day jump).
  const result = await recomputeSnapshot();
  return Response.json(result);
}
