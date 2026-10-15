"use client";

import { useRef, useState } from "react";
import { fmtUSD } from "./format";

type Cd = { label: string; principal: number; apy: number; open: string; maturity: string };

const W = 800;
const H = 220;
const PAD = { top: 12, right: 16, bottom: 28, left: 56 };
// Same four validated slots as the spending-category donut; extra CDs fold
// into one muted band.
const SLOTS = ["#17a06b", "#3b82d6", "#d9730d", "#c2255c"];
const OTHER = "#8aa498";
const GRID = "#243028";
const MUTED = "#8aa498";
const INK = "#deeade";
const SURFACE = "#141c17";
const YEAR_MS = 365.25 * 86_400_000;

const ms = (iso: string) => new Date(iso + "T00:00:00Z").getTime();

/** Interest a CD has accrued by time t (compounded at APY, capped at maturity). */
function accrued(cd: Cd, t: number): number {
  const open = ms(cd.open);
  if (t <= open) return 0;
  const years = (Math.min(t, ms(cd.maturity)) - open) / YEAR_MS;
  return cd.principal * (Math.pow(1 + cd.apy / 100, years) - 1);
}

function monthLabel(t: number): string {
  return new Date(t).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}

/** Interest earned across all CDs over time, stacked per CD, with today marked. */
export default function CdInterestChart({ cds, todayMs }: { cds: Cd[]; todayMs: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  if (cds.length === 0) return null;

  const series =
    cds.length <= SLOTS.length
      ? cds.map((cd, i) => ({ label: cd.label, color: SLOTS[i], cds: [cd] }))
      : [
          ...cds.slice(0, SLOTS.length - 1).map((cd, i) => ({ label: cd.label, color: SLOTS[i], cds: [cd] })),
          { label: `Other (${cds.length - SLOTS.length + 1})`, color: OTHER, cds: cds.slice(SLOTS.length - 1) },
        ];

  // Monthly samples from the first open to the last maturity.
  const start = Math.min(...cds.map((c) => ms(c.open)));
  const end = Math.max(...cds.map((c) => ms(c.maturity)));
  const times: number[] = [];
  const d = new Date(start);
  d.setUTCDate(1);
  while (d.getTime() <= end) {
    times.push(Math.max(d.getTime(), start));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  times.push(end);
  const values = times.map((t) => series.map((s) => s.cds.reduce((sum, cd) => sum + accrued(cd, t), 0)));
  const totals = values.map((v) => v.reduce((a, b) => a + b, 0));
  const max = Math.max(...totals, 1) * 1.05;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + ((t - start) / (end - start || 1)) * plotW;
  const y = (v: number) => PAD.top + (1 - v / max) * plotH;
  const edges: number[][] = [];
  series.forEach((_, s) => edges.push(values.map((v, i) => (s ? edges[s - 1][i] : 0) + v[s])));
  const line = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(times[i]).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const band = (s: number) =>
    line(edges[s]) +
    times
      .map((_, i) => times.length - 1 - i)
      .map((i) => `L${x(times[i]).toFixed(1)},${y(s ? edges[s - 1][i] : 0).toFixed(1)}`)
      .join("") +
    "Z";

  const earnedNow = cds.reduce((s, cd) => s + accrued(cd, todayMs), 0);
  const atMaturity = totals[totals.length - 1];
  const todayX = todayMs >= start && todayMs <= end ? x(todayMs) : null;
  const sel = hover != null ? hover : null;
  const labelEvery = Math.max(1, Math.ceil(times.length / 7));

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const t = start + ((px - PAD.left) / plotW) * (end - start);
    let best = 0;
    times.forEach((tt, i) => {
      if (Math.abs(tt - t) < Math.abs(times[best] - t)) best = i;
    });
    setHover(best);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-faint">
        {sel != null ? (
          <>
            <span className="text-subtle">{monthLabel(times[sel])}</span>
            <span className="tabular-nums">
              Earned <span className="text-prose">{fmtUSD(totals[sel])}</span>
            </span>
            {series.map((s, i) => (
              <span key={s.label} className="flex items-center gap-1.5 tabular-nums">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                {s.label} <span className="text-prose">{fmtUSD(values[sel][i])}</span>
              </span>
            ))}
          </>
        ) : (
          <>
            <span className="tabular-nums">
              Earned so far <span className="text-prose">{fmtUSD(earnedNow)}</span>
            </span>
            <span className="tabular-nums">
              By final maturity <span className="text-prose">{fmtUSD(atMaturity)}</span>
            </span>
            {series.map((s) => (
              <span key={s.label} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </>
        )}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`CD interest earned over time: ${fmtUSD(earnedNow)} so far, ${fmtUSD(atMaturity)} by final maturity`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={GRID} />
            <text x={PAD.left - 8} y={y(t) + 3.5} textAnchor="end" fontSize="11" fill={MUTED} style={{ fontVariantNumeric: "tabular-nums" }}>
              ${Math.round(t)}
            </text>
          </g>
        ))}
        {series.map((s, i) => (
          <path key={s.label} d={band(i)} fill={s.color} fillOpacity={0.8} />
        ))}
        {series.slice(0, -1).map((s, i) => (
          <path key={s.label} d={line(edges[i])} fill="none" stroke={SURFACE} strokeWidth="1.5" />
        ))}
        {todayX != null && (
          <g style={{ pointerEvents: "none" }}>
            <line x1={todayX} x2={todayX} y1={PAD.top} y2={PAD.top + plotH} stroke={INK} strokeDasharray="3 3" strokeOpacity="0.6" />
            <text x={todayX + 4} y={PAD.top + 10} fontSize="11" fill={INK}>
              today
            </text>
          </g>
        )}
        {times.map((t, i) =>
          i % labelEvery === 0 && i < times.length - 1 ? (
            <text key={i} x={x(t)} y={H - 8} textAnchor="middle" fontSize="11" fill={MUTED}>
              {monthLabel(t)}
            </text>
          ) : null
        )}
        {sel != null && (
          <line x1={x(times[sel])} x2={x(times[sel])} y1={PAD.top} y2={PAD.top + plotH} stroke={INK} strokeOpacity="0.4" style={{ pointerEvents: "none" }} />
        )}
      </svg>
    </div>
  );
}
