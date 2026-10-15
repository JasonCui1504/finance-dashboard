import { NextRequest } from "next/server";
import { requireSession } from "../../../../lib/finance/api";
import { runDailySnapshot } from "../../../../lib/finance/snapshot";

// Price fetching can be slow on Alpha Vantage's free tier (12.5s pacing
// between requests), so allow the full fluid-compute window.
export const maxDuration = 300;

// Vercel Cron invokes this route with GET and, when CRON_SECRET is set,
// an `Authorization: Bearer <CRON_SECRET>` header.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runDailySnapshot();
  return Response.json(result);
}

// Manual refresh from the dashboard UI.
export async function POST(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const result = await runDailySnapshot();
  return Response.json(result);
}
