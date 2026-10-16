// Daily stock quotes for manually-entered holdings.
// Primary: Alpha Vantage (ALPHAVANTAGE_API_KEY, free tier ~25 req/day).
// Fallback/alternative: Finnhub (FINNHUB_API_KEY, 60 req/min) — used
// automatically when no Alpha Vantage key is set, or when many tickers would
// blow past Alpha Vantage's per-minute pacing.

export type Quote = { ticker: string; price: number; prevClose: number | null };

/**
 * Reserved ticker for an account's uninvested cash (Robinhood cash, Fidelity
 * SPAXX). Its "shares" are dollars at a fixed $1 manual price, and it is never
 * sent to the price API — the real NASDAQ symbol CASH would misprice it.
 */
export const CASH_TICKER = "CASH";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchAlphaVantage(ticker: string): Promise<Quote> {
  const key = process.env.ALPHAVANTAGE_API_KEY;
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(
    ticker
  )}&apikey=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status} for ${ticker}`);
  const data = await res.json();
  if (data.Note || data.Information) {
    throw new Error(`Alpha Vantage rate limited: ${data.Note ?? data.Information}`);
  }
  const q = data["Global Quote"];
  const price = Number(q?.["05. price"]);
  if (!q || !Number.isFinite(price) || price <= 0) {
    throw new Error(`Alpha Vantage returned no quote for ${ticker}`);
  }
  const prevClose = Number(q["08. previous close"]);
  return {
    ticker,
    price,
    prevClose: Number.isFinite(prevClose) ? prevClose : null,
  };
}

async function fetchFinnhub(ticker: string): Promise<Quote> {
  const key = process.env.FINNHUB_API_KEY;
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(
    ticker
  )}&token=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub HTTP ${res.status} for ${ticker}`);
  const data = await res.json();
  const price = Number(data?.c);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Finnhub returned no quote for ${ticker}`);
  }
  const prevClose = Number(data.pc);
  return {
    ticker,
    price,
    prevClose: Number.isFinite(prevClose) ? prevClose : null,
  };
}

/**
 * Finnhub's industry label for a ticker, or "" when it has none (ETFs and
 * funds return an empty profile). Throws on HTTP errors such as rate limits,
 * so the caller can stop and pick the rest up on the next run.
 */
export async function fetchIndustry(ticker: string): Promise<string> {
  const key = process.env.FINNHUB_API_KEY;
  const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(
    ticker
  )}&token=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub profile HTTP ${res.status} for ${ticker}`);
  const data = await res.json();
  return typeof data?.finnhubIndustry === "string" ? data.finnhubIndustry : "";
}

export function priceProvider(): "alphavantage" | "finnhub" | null {
  if (process.env.ALPHAVANTAGE_API_KEY) return "alphavantage";
  if (process.env.FINNHUB_API_KEY) return "finnhub";
  return null;
}

/**
 * Fetch quotes sequentially (once daily, so pacing is fine). Returns quotes
 * for the tickers that succeeded plus error messages for those that didn't.
 */
export async function fetchQuotes(
  tickers: string[]
): Promise<{ quotes: Quote[]; errors: string[] }> {
  const provider = priceProvider();
  if (!provider) {
    return {
      quotes: [],
      errors: ["No price API key configured (ALPHAVANTAGE_API_KEY or FINNHUB_API_KEY)."],
    };
  }
  // Alpha Vantage free tier allows ~5 req/min; Finnhub 60/min.
  const delayMs =
    provider === "alphavantage" && tickers.length > 5 ? 12_500 : 400;
  const fetchOne = provider === "alphavantage" ? fetchAlphaVantage : fetchFinnhub;

  const quotes: Quote[] = [];
  const errors: string[] = [];
  for (let i = 0; i < tickers.length; i++) {
    if (i > 0) await sleep(delayMs);
    try {
      quotes.push(await fetchOne(tickers[i]));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { quotes, errors };
}
