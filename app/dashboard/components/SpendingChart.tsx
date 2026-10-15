"use client";

import { useEffect, useState } from "react";
import { fmtUSD } from "./format";
import { prefersReducedMotion } from "./motion";

type Point = { month: string; total: number };

const W = 800;
const H = 220;
const PAD = { top: 16, right: 12, bottom: 30, left: 56 };
const BAR = "#e87ba4"; // magenta slot — distinct from the asset series

function shortUSD(v: number): string {
  if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
}

function monthLabel(m: string): string {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-US", {
    month: "short",
  });
}

export default function SpendingChart({ data }: { data: Point[] }) {
  const [{ grown, instant }, setAnim] = useState({ grown: false, instant: false });
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const reduced = prefersReducedMotion();
    const raf = requestAnimationFrame(() =>
      setAnim({ grown: true, instant: reduced })
    );
    return () => cancelAnimationFrame(raf);
  }, []);

  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-faint">
        No spending logged yet. Add cards and monthly amounts under Manage →
        Spending.
      </p>
    );
  }

  const max = Math.max(...data.map((d) => d.total), 1);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / data.length;
  const barW = Math.min(46, slot * 0.6);
  const y = (v: number) => PAD.top + (1 - v / max) * plotH;
  const baseline = PAD.top + plotH;

  const ticks = [0, max / 2, max];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={`Monthly spending, latest ${fmtUSD(data[data.length - 1].total)}`}
      onMouseLeave={() => setHover(null)}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(t)}
            y2={y(t)}
            stroke="#243028"
            strokeWidth="1"
          />
          <text
            x={PAD.left - 8}
            y={y(t) + 3.5}
            textAnchor="end"
            fontSize="11"
            fill="#8aa498"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {shortUSD(t)}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const cx = PAD.left + slot * i + slot / 2;
        const x = cx - barW / 2;
        const full = baseline - y(d.total);
        const h = grown ? full : 0;
        const active = hover === i;
        return (
          <g key={d.month}>
            {/* generous invisible hit target */}
            <rect
              x={PAD.left + slot * i}
              y={PAD.top}
              width={slot}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
            <rect
              x={x}
              y={baseline - h}
              width={barW}
              height={h}
              rx="4"
              fill={BAR}
              opacity={active ? 1 : 0.85}
              style={{
                // The bar paints over its own hit target, so let pointer
                // events fall through — otherwise hovering the bar itself,
                // the obvious target, does nothing.
                pointerEvents: "none",
                transition: instant
                  ? "opacity 0.15s"
                  : "height 0.6s cubic-bezier(0.4,0,0.2,1), y 0.6s cubic-bezier(0.4,0,0.2,1), opacity 0.15s",
              }}
            />
            <text
              x={cx}
              y={H - 10}
              textAnchor="middle"
              fontSize="11"
              fill={active ? "#deeade" : "#8aa498"}
            >
              {monthLabel(d.month)}
            </text>
            {active && (
              <text
                x={cx}
                y={baseline - h - 6}
                textAnchor="middle"
                fontSize="11"
                fill="#deeade"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {fmtUSD(d.total)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
