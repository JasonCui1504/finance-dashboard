"use client";

import { useState } from "react";
import { fmtPct, fmtUSD } from "./format";

type Item = { ticker: string; value: number; dayPct: number | null };
type Rect = Item & { x: number; y: number; w: number; h: number };

const W = 800;
const H = 380;
const GAP = 2;
const MUTED = "#8aa498";
const INK = "#deeade";
const SUB = "#b0c8b8";
// Diverging scale: red ← neutral → green, capped at ±CAP% so one wild mover
// doesn't wash every other tile out to neutral.
const CAP = 3;
const NEUTRAL = [0x2a, 0x35, 0x30];
const UP = [0x17, 0xa0, 0x6b];
const DOWN = [0xd0, 0x3b, 0x3b];

function tileColor(pct: number | null): string {
  if (pct == null) return `rgb(${NEUTRAL.join(",")})`;
  const t = Math.min(1, Math.abs(pct) / CAP);
  const to = pct >= 0 ? UP : DOWN;
  const c = NEUTRAL.map((n, i) => Math.round(n + (to[i] - n) * t));
  return `rgb(${c.join(",")})`;
}

/** Worst aspect ratio of a row of areas laid along a side of length `side`. */
function worst(row: number[], side: number): number {
  const sum = row.reduce((s, v) => s + v, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

/** Squarified treemap (Bruls, Huizing & van Wijk): tiles as close to square as possible. */
function squarify(items: Item[], x: number, y: number, w: number, h: number): Rect[] {
  const total = items.reduce((s, i) => s + i.value, 0);
  const scale = (w * h) / total;
  const queue = items.map((i) => ({ item: i, area: i.value * scale }));
  const out: Rect[] = [];
  let box = { x, y, w, h };

  while (queue.length > 0) {
    const side = Math.min(box.w, box.h);
    const row = [queue.shift()!];
    while (
      queue.length > 0 &&
      worst([...row, queue[0]].map((r) => r.area), side) <= worst(row.map((r) => r.area), side)
    ) {
      row.push(queue.shift()!);
    }
    const rowArea = row.reduce((s, r) => s + r.area, 0);
    const thick = rowArea / side;
    let offset = 0;
    for (const r of row) {
      const len = r.area / thick;
      out.push(
        box.w >= box.h
          ? { ...r.item, x: box.x, y: box.y + offset, w: thick, h: len }
          : { ...r.item, x: box.x + offset, y: box.y, w: len, h: thick }
      );
      offset += len;
    }
    box =
      box.w >= box.h
        ? { x: box.x + thick, y: box.y, w: box.w - thick, h: box.h }
        : { x: box.x, y: box.y + thick, w: box.w, h: box.h - thick };
  }
  return out;
}

export default function HoldingsTreemap({ items }: { items: Item[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const sorted = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length === 0) {
    return <p className="py-8 text-center text-sm text-faint">No priced holdings yet.</p>;
  }
  const total = sorted.reduce((s, i) => s + i.value, 0);
  const rects = squarify(sorted, 0, 0, W, H);
  const sel = sorted.find((i) => i.ticker === hover) ?? null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-[18px] flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-faint">
        {sel ? (
          <>
            <span className="text-prose">{sel.ticker}</span>
            <span className="tabular-nums">
              Value <span className="text-prose">{fmtUSD(sel.value)}</span>
            </span>
            <span className="tabular-nums">
              <span className="text-prose">{((sel.value / total) * 100).toFixed(1)}%</span> of holdings
            </span>
            <span className="tabular-nums">
              Today{" "}
              <span className="text-prose">
                {sel.dayPct != null ? fmtPct(sel.dayPct) : "no live quote"}
              </span>
            </span>
          </>
        ) : (
          <span>
            {sorted.length} positions · {fmtUSD(total)} · size = value, colour = today&apos;s change
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <span className="tabular-nums">−{CAP}%</span>
          <span
            className="h-2 w-24 rounded-sm"
            style={{
              background: `linear-gradient(to right, ${tileColor(-CAP)}, ${tileColor(0)}, ${tileColor(CAP)})`,
            }}
            aria-hidden
          />
          <span className="tabular-nums">+{CAP}%</span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Holdings treemap of ${sorted.length} positions; largest ${sorted
          .slice(0, 3)
          .map((i) => `${i.ticker} ${((i.value / total) * 100).toFixed(0)}%`)
          .join(", ")}`}
        onMouseLeave={() => setHover(null)}
      >
        {rects.map((r) => {
          const w = Math.max(0, r.w - GAP);
          const h = Math.max(0, r.h - GAP);
          const active = hover === r.ticker;
          const big = w > 70 && h > 44;
          return (
            <g key={r.ticker} onMouseEnter={() => setHover(r.ticker)}>
              <rect
                x={r.x + GAP / 2}
                y={r.y + GAP / 2}
                width={w}
                height={h}
                rx="3"
                fill={tileColor(r.dayPct)}
                stroke={active ? INK : "none"}
                strokeWidth="1.5"
              />
              {w > 34 && h > 18 && (
                <text
                  x={r.x + GAP / 2 + 6}
                  y={r.y + GAP / 2 + 15}
                  fontSize={big ? 13 : 11}
                  fill={INK}
                  style={{ pointerEvents: "none" }}
                >
                  {r.ticker}
                </text>
              )}
              {big && (
                <text
                  x={r.x + GAP / 2 + 6}
                  y={r.y + GAP / 2 + 31}
                  fontSize="11"
                  fill={SUB}
                  style={{ pointerEvents: "none", fontVariantNumeric: "tabular-nums" }}
                >
                  {r.dayPct != null ? fmtPct(r.dayPct) : "—"}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="text-xs" style={{ color: MUTED }}>
        Positions in retirement accounts are included; tickers held at more than
        one broker are combined.
      </p>
    </div>
  );
}
