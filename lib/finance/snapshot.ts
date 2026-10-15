import { getDb } from "./db";
import { fetchIndustry, fetchQuotes } from "./prices";
import {
  cdCurrentValue,
  getLatestPrices,
  listAccounts,
  listCds,
  listHoldings,
} from "./queries";

export type SnapshotResult = {
  date: string;
  totalNetWorth: number;
  totalBrokerage: number;
  totalBank: number;
  totalCds: number;
  totalRetirement: number;
  dayChangePct: number | null;
  warnings: string[];
};

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Recompute today's snapshot from data already in the database (cached
 * prices, stored balances) — no external API calls. Called after every
 * account/holding/CD mutation so the dashboard totals update immediately.
 */
export async function recomputeSnapshot(
  warnings: string[] = []
): Promise<SnapshotResult> {
  const db = await getDb();
  const date = todayUtc();

  const [holdings, prices, accounts, cds] = await Promise.all([
    listHoldings(),
    getLatestPrices(),
    listAccounts(),
    listCds(),
  ]);

  const holdingRows: { holdingId: number; ticker: string; price: number; value: number }[] = [];
  // Value of the positions held inside each account, and of the loose
  // positions that aren't attached to one.
  const valueByAccount = new Map<number, number>();
  let unlinkedHoldingsValue = 0;
  for (const h of holdings) {
    const ticker = h.ticker.toUpperCase();
    const cached = prices.get(ticker);
    // Live quote first; fall back to a manually-entered price (for tickers the
    // price feed doesn't cover, e.g. OTC); otherwise 0.
    const price = cached?.price ?? h.manual_price ?? 0;
    if (!cached && h.manual_price == null) {
      warnings.push(`No price for ${ticker}; counted as $0.`);
    }
    const value = h.shares * price;
    if (h.account_id == null) unlinkedHoldingsValue += value;
    else valueByAccount.set(h.account_id, (valueByAccount.get(h.account_id) ?? 0) + value);
    holdingRows.push({ holdingId: h.id, ticker, price, value });
  }

  // An account holding positions is valued from them; its manual balance is
  // only a fallback for accounts with none, so the two can never be summed.
  const accountValue = (a: (typeof accounts)[number]) =>
    valueByAccount.get(a.id) ?? a.last_balance ?? 0;
  const accountBalance = (type: string) =>
    accounts.filter((a) => a.type === type).reduce((sum, a) => sum + accountValue(a), 0);

  const totalBrokerage = unlinkedHoldingsValue + accountBalance("brokerage");
  const totalBank = accountBalance("bank");
  const totalRetirement = accountBalance("retirement");
  const totalCds = cds.reduce((sum, cd) => sum + cdCurrentValue(cd), 0);
  const totalNetWorth = totalBrokerage + totalBank + totalCds + totalRetirement;

  const prev = await db.execute({
    sql: "SELECT total_net_worth FROM daily_snapshots WHERE date < ? ORDER BY date DESC LIMIT 1",
    args: [date],
  });
  const prevTotal = prev.rows.length ? Number(prev.rows[0].total_net_worth) : null;
  const dayChangePct =
    prevTotal != null && prevTotal !== 0
      ? ((totalNetWorth - prevTotal) / prevTotal) * 100
      : null;

  const allocation = {
    brokerage: totalBrokerage,
    bank: totalBank,
    cds: totalCds,
    retirement: totalRetirement,
  };

  const inserted = await db.execute({
    sql: `INSERT INTO daily_snapshots
            (date, total_net_worth, total_brokerage, total_bank, total_cds, total_retirement, day_change_pct, allocation_breakdown)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(date) DO UPDATE SET
            total_net_worth = excluded.total_net_worth,
            total_brokerage = excluded.total_brokerage,
            total_bank = excluded.total_bank,
            total_cds = excluded.total_cds,
            total_retirement = excluded.total_retirement,
            day_change_pct = excluded.day_change_pct,
            allocation_breakdown = excluded.allocation_breakdown
          RETURNING id`,
    args: [
      date,
      totalNetWorth,
      totalBrokerage,
      totalBank,
      totalCds,
      totalRetirement,
      dayChangePct,
      JSON.stringify(allocation),
    ],
  });
  const snapshotId = Number(inserted.rows[0].id);

  await db.execute({
    sql: "DELETE FROM snapshot_holdings WHERE snapshot_id = ?",
    args: [snapshotId],
  });
  for (const hr of holdingRows) {
    await db.execute({
      sql: `INSERT INTO snapshot_holdings (snapshot_id, holding_id, ticker, price, value)
            VALUES (?, ?, ?, ?, ?)`,
      args: [snapshotId, hr.holdingId, hr.ticker, hr.price, hr.value],
    });
  }

  return {
    date,
    totalNetWorth,
    totalBrokerage,
    totalBank,
    totalCds,
    totalRetirement,
    dayChangePct,
    warnings,
  };
}

/**
 * The once-daily job: refresh stock prices from the price API, then recompute
 * and store the snapshot.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runDailySnapshot(): Promise<SnapshotResult> {
  const db = await getDb();
  const warnings: string[] = [];

  // 1. Stock prices for manually-entered holdings.
  const holdings = await listHoldings();
  const tickers = [...new Set(holdings.map((h) => h.ticker.toUpperCase()))];
  if (tickers.length > 0) {
    const { quotes, errors } = await fetchQuotes(tickers);
    warnings.push(...errors);
    for (const q of quotes) {
      await db.execute({
        sql: `INSERT INTO latest_prices (ticker, price, prev_close, fetched_at)
              VALUES (?, ?, ?, datetime('now'))
              ON CONFLICT(ticker) DO UPDATE SET
                price = excluded.price,
                prev_close = excluded.prev_close,
                fetched_at = excluded.fetched_at`,
        args: [q.ticker.toUpperCase(), q.price, q.prevClose],
      });
    }
  }

  // 1b. Industry for tickers seen for the first time (Finnhub only). Cached
  // forever, so this is a one-off per ticker; paced under the 60/min limit,
  // and a failure just leaves the rest for the next run.
  if (process.env.FINNHUB_API_KEY && tickers.length > 0) {
    const known = await db.execute("SELECT ticker FROM ticker_profiles");
    const have = new Set(known.rows.map((r) => String(r.ticker)));
    const missing = tickers.filter((t) => !have.has(t)).slice(0, 60);
    for (let i = 0; i < missing.length; i++) {
      if (i > 0) await sleep(1_100);
      try {
        const industry = await fetchIndustry(missing[i]);
        await db.execute({
          sql: `INSERT INTO ticker_profiles (ticker, industry, fetched_at)
                VALUES (?, ?, datetime('now'))
                ON CONFLICT(ticker) DO UPDATE SET
                  industry = excluded.industry, fetched_at = excluded.fetched_at`,
          args: [missing[i], industry],
        });
      } catch (err) {
        warnings.push(err instanceof Error ? err.message : String(err));
        break;
      }
    }
  }

  // 2. Compute and store from the refreshed data.
  return recomputeSnapshot(warnings);
}
