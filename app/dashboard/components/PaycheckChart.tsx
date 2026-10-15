"use client";

import { useEffect, useState } from "react";
import { fmtUSD } from "./format";
import { prefersReducedMotion } from "./motion";

type Paycheck = { date: string; net: number; tax: number; gross: number };

const W = 800;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 30, left: 56 };
const RATE_H = 90;
const RATE_PAD = { top: 10, bottom: 10 };
// Same pair as the take-home / withheld split used elsewhere on the dashboard.
export const NET = "#17a06b";
export const TAX = "#d9730d";
const GRID = "#243028";
const MUTED = "#8aa498";
const INK = "#deeade";
const SURFACE = "#141c17";

function shortUSD(v: number): string {
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return `$${Math.round(v)}`;
}

function dayLabel(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** A rect with only its top corners rounded (the data end). */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export default function PaycheckChart({ data }: { data: Paycheck[] }) {
  const [{ grown, instant }, setAnim] = useState({ grown: false, instant: false });
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const reduced = prefersReducedMotion();
    const raf = requestAnimationFrame(() =>
      setAnim({ grown: true, instant: reduced })
    );
    return () => cancelAnimationFrame(raf);
  }, []);

  const shown = hover ?? data.length - 1;
  const sel = data[shown];
  const max = Math.max(...data.map((d) => d.gross), 1);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / data.length;
  const barW = Math.min(24, slot * 0.6);
  const y = (v: number) => PAD.top + (1 - v / max) * plotH;
  const baseline = PAD.top + plotH;
  const labelEvery = Math.ceil(data.length / 12);
  const ease = "0.6s cubic-bezier(0.4,0,0.2,1)";

  const rates = data.map((d) => (d.gross > 0 ? (d.tax / d.gross) * 100 : 0));
  const rMin = Math.max(0, Math.floor(Math.min(...rates) / 5) * 5 - 5);
  const rMax = Math.ceil(Math.max(...rates) / 5) * 5 + 5;
  const ry = (v: number) =>
    RATE_PAD.top + (1 - (v - rMin) / (rMax - rMin)) * (RATE_H - RATE_PAD.top - RATE_PAD.bottom);
  const cx = (i: number) => PAD.left + slot * i + slot / 2;
  const ratePath = rates.map((r, i) => `${i ? "L" : "M"}${cx(i)},${ry(r)}`).join("");

  const hitTargets = (h: number, top: number) =>
    data.map((d, i) => (
      <rect
        key={d.date + i}
        x={PAD.left + slot * i}
        y={top}
        width={slot}
        height={h}
        fill="transparent"
        onMouseEnter={() => setHover(i)}
      />
    ));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-faint">
        <span className="text-subtle">
          {hover == null ? "Latest" : "Paycheck"} · {dayLabel(sel.date)}
        </span>
        <span className="tabular-nums">
          Gross <span className="text-prose">{fmtUSD(sel.gross)}</span>
        </span>
        <span className="flex items-center gap-1.5 tabular-nums">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: NET }} />
          Take-home <span className="text-prose">{fmtUSD(sel.net)}</span>
        </span>
        <span className="flex items-center gap-1.5 tabular-nums">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: TAX }} />
          Tax <span className="text-prose">{fmtUSD(sel.tax)}</span>
          {sel.gross > 0 && ` (${((sel.tax / sel.gross) * 100).toFixed(1)}%)`}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`${data.length} paychecks this year; latest ${fmtUSD(data[data.length - 1].net)} take-home and ${fmtUSD(data[data.length - 1].tax)} tax`}
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
        {hitTargets(plotH, PAD.top)}
        {data.map((d, i) => {
          const x = cx(i) - barW / 2;
          const active = hover === i;
          const motion = instant ? "opacity 0.15s" : `transform ${ease}, opacity 0.15s`;
          return (
            <g key={d.date + i} style={{ pointerEvents: "none" }} opacity={hover == null || active ? 1 : 0.55}>
              <g
                style={{
                  transformOrigin: `${cx(i)}px ${baseline}px`,
                  transform: `scaleY(${grown ? 1 : 0})`,
                  transition: motion,
                }}
              >
                <path
                  d={
                    d.tax > 0
                      ? `M${x},${baseline}V${y(d.net)}H${x + barW}V${baseline}Z`
                      : topRounded(x, y(d.net), barW, baseline - y(d.net), 4)
                  }
                  fill={NET}
                />
                {/* Tax sits on take-home with a 2px surface gap between them. */}
                {d.tax > 0 && (
                  <path
                    d={topRounded(x, y(d.gross), barW, Math.max(0, y(d.net) - 2 - y(d.gross)), 4)}
                    fill={TAX}
                  />
                )}
              </g>
              {(i % labelEvery === 0 || active) && (
                <text
                  x={cx(i)}
                  y={H - 10}
                  textAnchor="middle"
                  fontSize="11"
                  fill={active ? INK : MUTED}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {dayLabel(d.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <p className="text-xs text-faint">Tax withheld, % of gross</p>
      <svg
        viewBox={`0 0 ${W} ${RATE_H}`}
        className="w-full"
        role="img"
        aria-label={`Effective tax rate per paycheck, from ${Math.min(...rates).toFixed(1)}% to ${Math.max(...rates).toFixed(1)}%`}
        onMouseLeave={() => setHover(null)}
      >
        {[rMin, rMax].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={ry(t)} y2={ry(t)} stroke={GRID} strokeWidth="1" />
            <text x={PAD.left - 8} y={ry(t) + 3.5} textAnchor="end" fontSize="11" fill={MUTED}>
              {t}%
            </text>
          </g>
        ))}
        {hitTargets(RATE_H, 0)}
        {data.length > 1 && (
          <path
            d={ratePath}
            fill="none"
            stroke={TAX}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{ pointerEvents: "none" }}
          />
        )}
        {rates.map((r, i) => (
          <circle
            key={i}
            cx={cx(i)}
            cy={ry(r)}
            r={hover === i || data.length === 1 ? 5 : 3.5}
            fill={TAX}
            stroke={SURFACE}
            strokeWidth="2"
            style={{ pointerEvents: "none" }}
          />
        ))}
      </svg>
    </div>
  );
}
