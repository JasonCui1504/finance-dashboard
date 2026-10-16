"use client";

import { useEffect, useState } from "react";
import { fmtUSD } from "./format";
import { prefersReducedMotion } from "./motion";

type Slice = { label: string; value: number };

const SIZE = 180;
const R = 70;
const THICKNESS = 22;
const GAP_RAD = 0.035; // ~2px surface gap between segments

// Four hues is the most this surface takes: every fifth hue collapsed into the
// blue under deuteranopia. Validated against #141c17 — lightness band, chroma,
// contrast and the normal-vision floor all pass; CVD separation sits in the
// 6–8 band, which the legend's labels and values cover as secondary encoding.
const SLOTS = ["#17a06b", "#3b82d6", "#d9730d", "#c2255c"];
const OTHER = "#8aa498";
/** Beyond the four coloured slots everything shares one muted slice. */
const MAX_SLICES = SLOTS.length;
/** The catch-all spending category (lib/finance/categories.ts). */
const CATCH_ALL = "Other";

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

export default function CategoryDonut({ slices }: { slices: Slice[] }) {
  const [{ mounted, instant }, setAnim] = useState({ mounted: false, instant: false });
  useEffect(() => {
    const reduced = prefersReducedMotion();
    const raf = requestAnimationFrame(() =>
      setAnim({ mounted: true, instant: reduced })
    );
    return () => cancelAnimationFrame(raf);
  }, []);

  const [hover, setHover] = useState<number | null>(null);

  // Refunds can push a category negative; a negative slice has no meaningful
  // share of a whole, so only positive spend is plotted.
  const positive = slices
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);

  if (positive.length === 0) {
    return <p className="text-sm text-faint">No spend to chart for this period.</p>;
  }

  // The catch-all "Other" category never takes a coloured slot: it shares
  // the muted slice, so a named category gets the colour instead and the
  // legend never shows "Other" twice.
  const named = positive.filter((s) => s.label !== CATCH_ALL);
  const catchAll = positive.find((s) => s.label === CATCH_ALL);
  const head = named.slice(0, MAX_SLICES);
  const rest = [...named.slice(MAX_SLICES), ...(catchAll ? [catchAll] : [])].sort(
    (a, b) => b.value - a.value
  );
  // One leftover keeps its own name; several fold into "More (N)", listed below it.
  const tail = rest.length > 1 ? rest : [];
  const visible: (Slice & { color: string })[] = head.map((s, i) => ({
    ...s,
    color: SLOTS[i],
  }));
  if (rest.length === 1) visible.push({ ...rest[0], color: OTHER });
  if (tail.length > 0) {
    visible.push({
      label: `More (${tail.length})`,
      value: tail.reduce((sum, s) => sum + s.value, 0),
      color: OTHER,
    });
  }
  const foldIndex = tail.length > 0 ? visible.length - 1 : -1;

  const total = visible.reduce((sum, s) => sum + s.value, 0);
  const c = SIZE / 2;
  const r = R - THICKNESS / 2;
  const pad = visible.length > 1 ? GAP_RAD / 2 : 0;
  const arcs = visible.map((s, i) => {
    const before = visible.slice(0, i).reduce((sum, p) => sum + p.value, 0);
    const start = -Math.PI / 2 + (before / total) * Math.PI * 2;
    const sweep = (s.value / total) * Math.PI * 2;
    const a0 = start + pad;
    const a1 = Math.max(start + sweep - pad, a0 + 0.01);
    return { ...s, a0, a1, len: r * (a1 - a0) };
  });

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-40 w-40 shrink-0"
        role="img"
        onMouseLeave={() => setHover(null)}
        aria-label={`Spend by category: ${visible
          .map((s) => `${s.label} ${((s.value / total) * 100).toFixed(0)}%`)
          .join(", ")}`}
      >
        {arcs.map((a, i) => (
          <path
            key={a.label}
            d={arcPath(c, c, r, a.a0, a.a1)}
            fill="none"
            stroke={a.color}
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
            <title>
              {`${a.label}: ${fmtUSD(a.value)} (${((a.value / total) * 100).toFixed(1)}%)` +
                (i === foldIndex
                  ? ` — ${tail.map((t) => t.label).join(", ")}`
                  : "")}
            </title>
          </path>
        ))}
        <text x={c} y={c - 10} textAnchor="middle" fontSize="11" fill="#8aa498">
          {hover == null ? "Spend" : arcs[hover].label}
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
      <ul className="flex min-w-[190px] flex-col gap-2.5 text-sm">
        {visible.map((s, i) => (
          <li
            key={s.label}
            className="flex flex-col gap-1.5 transition-opacity"
            style={{ opacity: hover == null || hover === i ? 1 : 0.5 }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <div className="flex items-center gap-2.5">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: s.color }}
                aria-hidden
              />
              <span className="text-subtle">{s.label}</span>
              <span className="ml-auto pl-4 text-prose tabular-nums">
                {fmtUSD(s.value)}
              </span>
              <span className="w-11 text-right text-faint tabular-nums">
                {((s.value / total) * 100).toFixed(0)}%
              </span>
            </div>
            {/* Name what "More" holds — the slice only has room for one colour. */}
            {i === foldIndex &&
              tail.map((t) => (
                <div key={t.label} className="flex items-center gap-2.5 pl-5 text-xs">
                  <span className="text-faint">{t.label}</span>
                  <span className="ml-auto pl-4 text-subtle tabular-nums">{fmtUSD(t.value)}</span>
                  <span className="w-11 text-right text-faint tabular-nums">
                    {((t.value / total) * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
