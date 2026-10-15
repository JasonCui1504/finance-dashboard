"use client";

import { useState } from "react";

type Parsed = {
  ticker: string;
  shares: number;
  manualPrice: number | null;
  include: boolean;
};

const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;

const btnCls =
  "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-canvas transition-opacity hover:opacity-90 disabled:opacity-50";
const ghostBtnCls =
  "rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:border-accent hover:text-prose";

function splitRow(line: string): string[] {
  // Prefer tab, then comma, then runs of 2+ spaces (pasted tables).
  if (line.includes("\t")) return line.split("\t");
  if (line.includes(",")) return line.split(",");
  return line.split(/\s{2,}/);
}

/**
 * Paste a positions table (from a brokerage export or spreadsheet) and pull out
 * ticker + share count. Finds the columns by header name; falls back to "first
 * ticker-looking cell + first positive number" per row.
 */
function parse(text: string): Parsed[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const header = splitRow(lines[0]).map((c) => c.trim().toLowerCase());
  const hasHeader = header.some((c) => /symbol|ticker|shares|quantity/.test(c));
  let symIdx = -1;
  let shrIdx = -1;
  let ocIdx = -1;
  let priceIdx = -1;
  let valueIdx = -1;
  if (hasHeader) {
    symIdx = header.findIndex((c) => /symbol|ticker/.test(c));
    shrIdx = header.findIndex((c) => /shares|quantity|qty/.test(c));
    ocIdx = header.findIndex((c) => /open|close|action/.test(c));
    // A per-share price column ("Price" or "Current"), not "Current Value".
    priceIdx = header.findIndex((c) => /price/.test(c) || c === "current");
    // A total-value column, used to derive per-share when there's no price.
    valueIdx = header.findIndex((c) => /value|market val|mkt/.test(c));
  }

  const out: Parsed[] = [];
  const seen = new Set<string>();
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const cells = splitRow(lines[i]).map((c) => c.trim());
    // Skip explicitly closed positions.
    if (ocIdx >= 0 && /close/i.test(cells[ocIdx] ?? "")) continue;

    let ticker = "";
    let shares = NaN;
    if (symIdx >= 0 && shrIdx >= 0) {
      ticker = (cells[symIdx] ?? "").toUpperCase();
      shares = Number((cells[shrIdx] ?? "").replace(/[,\s]/g, ""));
    } else {
      // positional fallback: first ticker-ish cell, first positive number
      for (const c of cells) {
        const up = c.toUpperCase();
        if (!ticker && TICKER_RE.test(up) && !/^\d+$/.test(up)) ticker = up;
        else if (Number.isNaN(shares)) {
          const n = Number(c.replace(/[,\s]/g, ""));
          if (Number.isFinite(n) && n > 0) shares = n;
        }
      }
    }
    if (!TICKER_RE.test(ticker) || !Number.isFinite(shares) || shares <= 0) continue;
    if (seen.has(ticker)) continue;
    seen.add(ticker);
    let manualPrice: number | null = null;
    if (priceIdx >= 0) {
      const p = Number((cells[priceIdx] ?? "").replace(/[$,\s]/g, ""));
      if (Number.isFinite(p) && p > 0) manualPrice = p;
    }
    // Fall back to (total value ÷ shares) when there's no per-share price.
    if (manualPrice == null && valueIdx >= 0) {
      const v = Number((cells[valueIdx] ?? "").replace(/[$,\s]/g, ""));
      if (Number.isFinite(v) && v > 0) manualPrice = Math.round((v / shares) * 100) / 100;
    }
    out.push({ ticker, shares, manualPrice, include: true });
  }
  return out;
}

export default function HoldingsImport({
  onImported,
  onError,
}: {
  onImported: (n: number) => void;
  onError: (msg: string) => void;
}) {
  const [text, setText] = useState("");
  const [broker, setBroker] = useState("");
  const [rows, setRows] = useState<Parsed[] | null>(null);

  function doParse() {
    const parsed = parse(text);
    if (parsed.length === 0) {
      onError("Couldn't find any ticker + shares rows in that paste.");
      return;
    }
    setRows(parsed);
  }

  function toggle(i: number) {
    setRows((prev) =>
      prev ? prev.map((r, idx) => (idx === i ? { ...r, include: !r.include } : r)) : prev
    );
  }

  async function doImport() {
    const include = (rows ?? []).filter((r) => r.include);
    if (include.length === 0) {
      onError("No rows selected.");
      return;
    }
    try {
      const res = await fetch("/api/finance/holdings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          holdings: include.map((r) => ({
            ticker: r.ticker,
            shares: r.shares,
            manual_price: r.manualPrice,
            broker: broker.trim() || null,
          })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Import failed");
      onImported(data.added ?? include.length);
      setText("");
      setRows(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Import failed");
    }
  }

  const included = rows?.filter((r) => r.include) ?? [];

  return (
    <div className="flex flex-col gap-3">
      <label className="flex w-fit flex-col gap-1 text-xs text-faint">
        Broker for these holdings (e.g. Schwab, Robinhood)
        <input
          value={broker}
          onChange={(e) => setBroker(e.target.value)}
          placeholder="optional"
          className="rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm text-prose outline-none transition-colors focus:border-accent"
        />
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder={"Paste a positions table (with a header row), e.g.\nSymbol\tShares\nAAPL\t10\nVOO\t3"}
        className="w-full rounded-md border border-line bg-canvas px-3 py-2 font-mono text-xs text-prose outline-none transition-colors focus:border-accent"
      />
      <div className="flex items-center gap-2">
        <button type="button" onClick={doParse} disabled={!text.trim()} className={ghostBtnCls}>
          Preview
        </button>
        {rows && (
          <button type="button" onClick={doImport} className={btnCls}>
            Import {included.length} holdings
          </button>
        )}
      </div>

      {rows && (
        <div className="max-h-64 overflow-y-auto rounded border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface text-left text-xs text-faint">
              <tr>
                <th className="p-2 font-normal">✓</th>
                <th className="p-2 font-normal">Ticker</th>
                <th className="p-2 text-right font-normal">Shares</th>
                <th className="p-2 text-right font-normal">Manual price</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.ticker}
                  className={`border-t border-line ${r.include ? "" : "opacity-40"}`}
                >
                  <td className="p-2">
                    <input type="checkbox" checked={r.include} onChange={() => toggle(i)} />
                  </td>
                  <td className="p-2 text-prose">{r.ticker}</td>
                  <td className="p-2 text-right tabular-nums text-subtle">{r.shares}</td>
                  <td className="p-2 text-right tabular-nums text-faint">
                    {r.manualPrice != null ? `$${r.manualPrice}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-faint">
        Paste from a brokerage export or spreadsheet — it reads the ticker and
        share count (tab, comma, or space separated) and skips closed positions.
        Holdings count toward net worth on their own; no brokerage account needed.
      </p>
    </div>
  );
}
