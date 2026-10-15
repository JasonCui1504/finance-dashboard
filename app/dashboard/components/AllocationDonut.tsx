"use client";

import { useEffect, useState } from "react";
import { fmtUSD, SERIES } from "./format";
import { prefersReducedMotion } from "./motion";

type Slice = { key: keyof typeof SERIES; label: string; value: number };

const SIZE = 180;
const R = 70;
const THICKNESS = 22;
const GAP_RAD = 0.035; // ~2px surface gap between segments

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

export default function AllocationDonut({ slices }: { slices: Slice[] }) {
  // `mounted` flips the arcs from hidden (dashoffset = len) to drawn; `instant`
  // skips the sweep for reduced-motion. Both are set once via rAF so nothing
  // updates state synchronously in the effect.
  const [{ mounted, instant }, setAnim] = useState({
    mounted: false,
    instant: false,
  });
  useEffect(() => {
    const reduced = prefersReducedMotion();
    const raf = requestAnimationFrame(() =>
      setAnim({ mounted: true, instant: reduced })
    );
    return () => cancelAnimationFrame(raf);
  }, []);

  const [hover, setHover] = useState<number | null>(null);

  const visible = slices.filter((s) => s.value > 0);
  const total = visible.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) {
    return <p className="text-sm text-faint">No allocation data yet.</p>;
  }

  const c = SIZE / 2;
  const r = R - THICKNESS / 2;
  const pad = visible.length > 1 ? GAP_RAD / 2 : 0;
  const cumulative = visible.map((s, i) =>
    visible.slice(0, i).reduce((sum, p) => sum + p.value, 0)
  );
  const arcs = visible.map((s, i) => {
    const start = -Math.PI / 2 + (cumulative[i] / total) * Math.PI * 2;
    const sweep = (s.value / total) * Math.PI * 2;
    const a0 = start + pad;
    const a1 = Math.max(start + sweep - pad, a0 + 0.01);
    return { ...s, a0, a1, len: r * (a1 - a0) };
  });

  return (
    <div className="flex items-center gap-6">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-40 w-40 shrink-0"
        role="img"
        onMouseLeave={() => setHover(null)}
        aria-label={`Allocation: ${visible
          .map((s) => `${s.label} ${((s.value / total) * 100).toFixed(0)}%`)
          .join(", ")}`}
      >
        {arcs.map((a, i) => (
          <path
            key={a.key}
            d={arcPath(c, c, r, a.a0, a.a1)}
            fill="none"
            stroke={SERIES[a.key]}
            strokeWidth={hover === i ? THICKNESS + 4 : THICKNESS}
            strokeOpacity={hover == null || hover === i ? 1 : 0.35}
            onMouseEnter={() => setHover(i)}
            strokeDasharray={a.len}
            strokeDashoffset={mounted ? 0 : a.len}
            style={{
              transition: instant
                ? "none"
                : `stroke-dashoffset 0.9s cubic-bezier(0.4, 0, 0.2, 1) ${i * 120}ms, stroke-width 0.15s, stroke-opacity 0.15s`,
            }}
          >
            <title>{`${a.label}: ${fmtUSD(a.value)} (${((a.value / total) * 100).toFixed(1)}%)`}</title>
          </path>
        ))}
        <text x={c} y={c - 10} textAnchor="middle" fontSize="11" fill="#8aa498">
          {hover == null ? "Total" : arcs[hover].label}
        </text>
        <text x={c} y={c + 8} textAnchor="middle" fontSize="15" fill="#deeade">
          {fmtUSD(hover == null ? total : arcs[hover].value)}
        </text>
        {hover != null && (
          <text x={c} y={c + 24} textAnchor="middle" fontSize="11" fill="#8aa498">
            {((arcs[hover].value / total) * 100).toFixed(1)}%
          </text>
        )}
      </svg>
      <ul className="flex flex-col gap-2.5 text-sm">
        {visible.map((s, i) => (
          <li
            key={s.key}
            className="flex items-center gap-2.5 transition-opacity"
            style={{ opacity: hover == null || hover === i ? 1 : 0.5 }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: SERIES[s.key] }}
              aria-hidden
            />
            <span className="text-subtle">{s.label}</span>
            <span className="ml-auto pl-6 text-prose tabular-nums">
              {fmtUSD(s.value)}
            </span>
            <span className="w-12 text-right text-faint tabular-nums">
              {((s.value / total) * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
