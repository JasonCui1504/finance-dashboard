import { NextRequest } from "next/server";
import { badRequest, parseId, requireSession } from "../../../../../lib/finance/api";
import { getDb } from "../../../../../lib/finance/db";
import { CASH_TICKER } from "../../../../../lib/finance/prices";
import { recomputeSnapshot } from "../../../../../lib/finance/snapshot";

type Ctx = { params: Promise<{ id: string }> };

const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;

export async function PUT(request: NextRequest, ctx: Ctx) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const id = parseId((await ctx.params).id);
  if (!id) return badRequest("Invalid id");

  const b = await request.json();
  const ticker =
    typeof b.ticker === "string" && b.ticker.trim() ? b.ticker.trim().toUpperCase() : null;
  if (ticker != null && !TICKER_RE.test(ticker)) return badRequest(`Invalid ticker: ${ticker}`);
  const shares = b.shares == null ? null : Number(b.shares);
  if (shares != null && (!Number.isFinite(shares) || shares <= 0)) {
    return badRequest("shares must be > 0");
  }
  // The optional fields below: absent = leave alone; null/"" = clear; value = set.
  const manualProvided = "manual_price" in b;
  const manualPrice =
    b.manual_price == null || b.manual_price === "" ? null : Number(b.manual_price);
  if (manualProvided && manualPrice != null && (!Number.isFinite(manualPrice) || manualPrice < 0)) {
    return badRequest("Invalid manual price");
  }
  const costProvided = "cost_basis" in b;
  const costBasis =
    b.cost_basis == null || b.cost_basis === "" ? null : Number(b.cost_basis);
  if (costProvided && costBasis != null && (!Number.isFinite(costBasis) || costBasis < 0)) {
    return badRequest("Invalid cost basis");
  }
  const brokerProvided = "broker" in b;
  const broker =
    typeof b.broker === "string" && b.broker.trim() ? b.broker.trim().slice(0, 40) : null;
  // Moving a holding to another account (or unlinking it with null).
  const accountProvided = "account_id" in b;
  const accountId = b.account_id == null || b.account_id === "" ? null : Number(b.account_id);
  if (accountProvided && accountId != null && (!Number.isInteger(accountId) || accountId <= 0)) {
    return badRequest("Invalid account");
  }

  const db = await getDb();
  await db.batch(
    [
      {
        sql: `UPDATE holdings SET
                ticker = COALESCE(?, ticker),
                shares = COALESCE(?, shares),
                manual_price = CASE WHEN ? THEN ? ELSE manual_price END,
                cost_basis = CASE WHEN ? THEN ? ELSE cost_basis END,
                broker = CASE WHEN ? THEN ? ELSE broker END,
                account_id = CASE WHEN ? THEN ? ELSE account_id END
              WHERE id = ?`,
        args: [
          ticker,
          shares,
          manualProvided ? 1 : 0,
          manualPrice,
          costProvided ? 1 : 0,
          costBasis,
          brokerProvided ? 1 : 0,
          broker,
          accountProvided ? 1 : 0,
          accountId,
          id,
        ],
      },
      // Cash is always valued at $1 a share (its shares are dollars).
      {
        sql: "UPDATE holdings SET manual_price = 1 WHERE id = ? AND ticker = ?",
        args: [id, CASH_TICKER],
      },
    ],
    "write"
  );
  await recomputeSnapshot();
  return Response.json({ ok: true });
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const unauthorized = requireSession(request);
  if (unauthorized) return unauthorized;
  const id = parseId((await ctx.params).id);
  if (!id) return badRequest("Invalid id");
  const db = await getDb();
  await db.execute({ sql: "DELETE FROM holdings WHERE id = ?", args: [id] });
  await recomputeSnapshot();
  return Response.json({ ok: true });
}
