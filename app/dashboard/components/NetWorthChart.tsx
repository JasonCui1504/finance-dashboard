"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtUSD } from "./format";

type Point = { date: string; value: number };

const RANGES = [
  { key: "30", label: "30D", days: 30 },
  { key: "90", label: "90D", days: 90 },
  { key: "365", label: "1Y", days: 365 },
  { key: "all", label: "All", days: Infinity },
] as const;

const W = 800;
const H = 260;
const PAD = { top: 16, right: 16, bottom: 28, left: 64 };
const LINE = "#3987e5";
const N = 121; // fixed sample count so ranges of different lengths can morph
const MORPH_MS = 350;

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min];
  const span = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(span / count)));
  const err = (span / count) / step;
  const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
  const s = step * mult;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / s) * s; v <= max; v += s) ticks.push(v);
  return ticks;
}

function shortUSD(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
}

/** Linear resample of a series to exactly N values. */
function resample(points: Point[], n: number): number[] {
  const L = points.length;
  if (L === 0) return [];
  if (L === 1) return Array(n).fill(points[0].value);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i * (L - 1)) / (n - 1);
    const lo = Math.floor(t);
    const hi = Math.min(L - 1, lo + 1);
    const frac = t - lo;
    out.push(points[lo].value * (1 - frac) + points[hi].value * frac);
  }
  return out;
}

export default function NetWorthChart({
  data,
  label = "Net worth",
}: {
  data: Point[];
  label?: string;
}) {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("90");
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const points = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)!.days;
    return days === Infinity ? data : data.slice(-days);
  }, [data, range]);

  const target = useMemo(() => resample(points, N), [points]);

  // Morph the drawn samples toward the target whenever the range changes.
  const [samples, setSamples] = useState(target);
  const samplesRef = useRef(target);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      samplesRef.current = target;
      setSamples(target);
      return;
    }
    if (
      target.length !== samplesRef.current.length ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      samplesRef.current = target;
      setSamples(target);
      return;
    }
    const from = [...samplesRef.current];
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / MORPH_MS);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = from.map((v, i) => v + (target[i] - v) * eased);
      samplesRef.current = next;
      setSamples(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  const geom = useMemo(() => {
    if (samples.length < 2) return null;
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    const spread = max - min || max * 0.02 || 1;
    const lo = min - spread * 0.08;
    const hi = max + spread * 0.08;
    const plotW = W - PAD.left - PAD.right;
    const x = (frac: number) => PAD.left + frac * plotW;
    const y = (v: number) =>
      PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
    const path = samples
      .map(
        (v, i) =>
          `${i === 0 ? "M" : "L"}${x(i / (N - 1)).toFixed(1)},${y(v).toFixed(1)}`
      )
      .join("");
    const area = `${path}L${x(1).toFixed(1)},${H - PAD.bottom}L${PAD.left},${
      H - PAD.bottom
    }Z`;
    return { x, y, path, area, ticks: niceTicks(lo, hi) };
  }, [samples]);

  if (!geom || points.length < 2) {
    return (
      <p className="py-10 text-center text-sm text-faint">
        Not enough history yet — snapshots build this chart one day at a time.
      </p>
    );
  }

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const frac = (px - PAD.left) / (W - PAD.left - PAD.right);
    const i = Math.round(frac * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  }

  const h = hover != null ? points[hover] : null;
  const last = points[points.length - 1];
  const xLabels = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  const hoverFrac = (i: number) => i / (points.length - 1);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`rounded px-2.5 py-1 text-xs transition-colors ${
                range === r.key
                  ? "bg-lift text-prose"
                  : "text-faint hover:text-subtle"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {h && (
          <div className="text-xs text-subtle tabular-nums">
            {new Date(h.date + "T00:00:00").toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
            {" · "}
            <span className="text-prose">{fmtUSD(h.value)}</span>
          </div>
        )}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`${label} over time, currently ${fmtUSD(last.value)}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="nw-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={LINE} stopOpacity="0.22" />
            <stop offset="100%" stopColor={LINE} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* gridlines + y ticks */}
        {geom.ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={geom.y(t)}
              y2={geom.y(t)}
              stroke="#243028"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 8}
              y={geom.y(t) + 3.5}
              textAnchor="end"
              fontSize="11"
              fill="#8aa498"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {shortUSD(t)}
            </text>
          </g>
        ))}
        {/* x labels */}
        {xLabels.map((i) => (
          <text
            key={i}
            x={geom.x(hoverFrac(i))}
            y={H - 8}
            textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
            fontSize="11"
            fill="#8aa498"
          >
            {new Date(points[i].date + "T00:00:00").toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </text>
        ))}
        {/* gradient area + animated line */}
        <path d={geom.area} fill="url(#nw-area)" className="fin-fade" />
        <path
          d={geom.path}
          fill="none"
          stroke={LINE}
          strokeWidth="2"
          pathLength={1}
          className="fin-draw"
        />
        {/* pulsing endpoint */}
        <circle
          cx={geom.x(1)}
          cy={geom.y(samples[N - 1])}
          r="4"
          fill={LINE}
          opacity="0.5"
          className="fin-pulse"
        />
        <circle
          cx={geom.x(1)}
          cy={geom.y(samples[N - 1])}
          r="4"
          fill={LINE}
          stroke="#141c17"
          strokeWidth="2"
        />
        {/* hover crosshair */}
        {h && hover != null && (
          <g>
            <line
              x1={geom.x(hoverFrac(hover))}
              x2={geom.x(hoverFrac(hover))}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="#8aa498"
              strokeWidth="1"
              opacity="0.5"
            />
            <circle
              cx={geom.x(hoverFrac(hover))}
              cy={geom.y(h.value)}
              r="5"
              fill={LINE}
              stroke="#141c17"
              strokeWidth="2"
            />
          </g>
        )}
      </svg>
    </div>
  );
}
