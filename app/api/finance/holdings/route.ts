import { NextRequest } from "next/server";
import { badRequest, requireSession } from "../../../../lib/finance/api";
import { getDb } from "../../../../lib/finance/db";
import { listHoldings } from "../../../../lib/finance/queries";
import { recomputeSnapshot } from "../../../../lib/finance/snapshot";

export async function GET(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  return Response.json(await listHoldings());
}

const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;

// Accepts a single holding (ticker, shares) or a bulk paste-import
// ({ holdings: [{ ticker, shares }, ...] }). Cost basis is no longer tracked.
export async function POST(request: NextRequest) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;

  const b = await request.json();
  const raw: unknown[] = Array.isArray(b.holdings) ? b.holdings : [b];
  if (raw.length === 0) return badRequest("No holdings provided");
  if (raw.length > 500) return badRequest("Too many holdings in one import (max 500)");

  const rows: {
    ticker: string;
    shares: number;
    manualPrice: number | null;
    broker: string | null;
    accountId: number | null;
  }[] = [];
  for (const item of raw) {
    const h = item as Record<string, unknown>;
    const ticker = typeof h.ticker === "string" ? h.ticker.trim().toUpperCase() : "";
    const shares = Number(h.shares);
    if (!TICKER_RE.test(ticker)) return badRequest(`Invalid ticker: ${ticker || "(empty)"}`);
    if (!Number.isFinite(shares) || shares <= 0) {
      return badRequest(`shares must be > 0 for ${ticker}`);
    }
    const manualPrice =
      h.manual_price == null || h.manual_price === "" ? null : Number(h.manual_price);
    if (manualPrice != null && (!Number.isFinite(manualPrice) || manualPrice < 0)) {
      return badRequest(`Invalid manual price for ${ticker}`);
    }
    const broker =
      typeof h.broker === "string" && h.broker.trim() ? h.broker.trim().slice(0, 40) : null;
    // Linking a holding to an account moves its value onto that account, and
    // the account's manual balance stops being counted.
    const accountId =
      h.account_id == null || h.account_id === "" ? null : Number(h.account_id);
    if (accountId != null && (!Number.isInteger(accountId) || accountId <= 0)) {
      return badRequest(`Invalid account for ${ticker}`);
    }
    rows.push({ ticker, shares, manualPrice, broker, accountId });
  }

  const db = await getDb();
  await db.batch(
    rows.map((r) => ({
      sql: `INSERT INTO holdings (account_id, ticker, shares, cost_basis, purchase_date, manual_price, broker)
            VALUES (?, ?, ?, NULL, NULL, ?, ?)`,
      args: [r.accountId, r.ticker, r.shares, r.manualPrice, r.broker],
    })),
    "write"
  );
  await recomputeSnapshot();
  return Response.json({ ok: true, added: rows.length }, { status: 201 });
}
