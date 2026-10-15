"use client";

import { useEffect, useState } from "react";
import { DELTA_DOWN, DELTA_UP, fmtUSD } from "./format";
import { prefersReducedMotion } from "./motion";

/** income is take-home; tax is what was withheld from it, stacked on top. */
type Month = { month: string; income: number; tax: number; spending: number };

const W = 800;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 30, left: 56 };
// Take-home and tax match the paycheck chart; spending matches the spending chart.
const INCOME = "#17a06b";
const TAX = "#d9730d";
const SPEND = "#e87ba4";
const GRID = "#243028";
const MUTED = "#8aa498";
const INK = "#deeade";

function shortUSD(v: number): string {
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return `$${Math.round(v)}`;
}

function monthLabel(m: string, long = false): string {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-US", {
    month: long ? "long" : "short",
    ...(long ? { year: "numeric" } : {}),
  });
}

/**
 * Per month: gross pay as take-home with tax stacked on top, beside spending,
 * with what was kept (take-home minus spending) or fell short.
 */
export default function IncomeVsSpending({
  data,
  currentMonth,
}: {
  data: Month[];
  currentMonth: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [{ grown, instant }, setAnim] = useState({ grown: false, instant: false });
  useEffect(() => {
    const reduced = prefersReducedMotion();
    const raf = requestAnimationFrame(() => setAnim({ grown: true, instant: reduced }));
    return () => cancelAnimationFrame(raf);
  }, []);

  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-faint">
        Log paychecks and spending to compare them month by month.
      </p>
    );
  }

  const sel = data[hover ?? data.length - 1];
  const kept = sel.income - sel.spending;
  const max = Math.max(...data.flatMap((d) => [d.income + d.tax, d.spending]), 1);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / data.length;
  const barW = Math.min(24, (slot * 0.7) / 2);
  const y = (v: number) => PAD.top + (1 - v / max) * plotH;
  const baseline = PAD.top + plotH;
  const noSpending = data.every((d) => d.spending === 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-faint">
        <span className="text-subtle">
          {monthLabel(sel.month, true)}
          {sel.month === currentMonth ? " (so far)" : ""}
        </span>
        <span className="flex items-center gap-1.5 tabular-nums">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: INCOME }} />
          Take-home <span className="text-prose">{fmtUSD(sel.income)}</span>
        </span>
        <span className="flex items-center gap-1.5 tabular-nums">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: TAX }} />
          Tax <span className="text-prose">{fmtUSD(sel.tax)}</span>
        </span>
        <span className="flex items-center gap-1.5 tabular-nums">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SPEND }} />
          Spending <span className="text-prose">{fmtUSD(sel.spending)}</span>
        </span>
        <span className="tabular-nums">
          {kept >= 0 ? "Kept" : "Short"}{" "}
          <span style={{ color: kept >= 0 ? DELTA_UP : DELTA_DOWN }}>
            {fmtUSD(Math.abs(kept))}
          </span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Take-home versus spending over ${data.length} months`}
        onMouseLeave={() => setHover(null)}
      >
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth="1" />
            <text
              x={PAD.left - 8}
              y={y(t) + 3.5}
              textAnchor="end"
              fontSize="11"
              fill={MUTED}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {shortUSD(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          const active = hover === i;
          // `base` lifts a segment to sit on another (tax on take-home).
          const bar = (v: number, x: number, fill: string, rounded: boolean, base = 0) => {
            const h = grown ? Math.max(0, baseline - y(v) - (base ? 2 : 0)) : 0;
            const b = grown ? baseline - y(base) : 0;
            return (
              <rect
                x={x}
                y={baseline - b - (base ? 2 : 0) - h}
                width={barW}
                height={h}
                rx={rounded ? Math.min(4, h / 2) : 0}
                fill={fill}
                style={{
                  transition: instant
                    ? "none"
                    : "height 0.6s cubic-bezier(0.4,0,0.2,1), y 0.6s cubic-bezier(0.4,0,0.2,1)",
                }}
              />
            );
          };
          return (
            <g key={d.month} onMouseEnter={() => setHover(i)}>
              <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={plotH} fill="transparent" />
              <g style={{ pointerEvents: "none" }} opacity={hover == null || active ? 1 : 0.55}>
                {/* 2px surface gap between the pair. */}
                {bar(d.income, cx - barW - 1, INCOME, d.tax === 0)}
                {d.tax > 0 && bar(d.tax, cx - barW - 1, TAX, true, d.income)}
                {bar(d.spending, cx + 1, SPEND, true)}
              </g>
              <text
                x={cx}
                y={H - 10}
                textAnchor="middle"
                fontSize="11"
                fill={active ? INK : MUTED}
                style={{ pointerEvents: "none" }}
              >
                {monthLabel(d.month)}
              </text>
            </g>
          );
        })}
      </svg>
      {noSpending && (
        <p className="text-xs text-faint">
          No spending recorded yet — import a card statement under Manage → Spending
          to fill in the pink bars.
        </p>
      )}
    </div>
  );
}
