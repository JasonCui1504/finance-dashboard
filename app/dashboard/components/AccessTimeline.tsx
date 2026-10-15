"use client";

import { useState } from "react";
import { fmtUSD, SERIES } from "./format";

type Bucket = { key: string; label: string; note: string; value: number; color: string };
type Unlock = { date: string; label: string; value: number };

const W = 800;
const H = 170;
const PAD = { top: 14, right: 16, bottom: 26, left: 64 };
const GRID = "#243028";
const MUTED = "#8aa498";
const INK = "#deeade";
const SURFACE = "#141c17";

function shortUSD(v: number): string {
  if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
}

function dateLabel(iso: string, withYear = false): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    ...(withYear ? { day: "numeric", year: "numeric" } : { year: "2-digit" }),
  });
}

/**
 * Net worth by how soon it could be spent: a split of today's total, then
 * how the reachable amount steps up as each CD matures.
 */
export default function AccessTimeline({
  cash,
  investments,
  cdsLocked,
  retirement,
  unlocks,
  today,
}: {
  cash: number;
  investments: number;
  cdsLocked: number;
  retirement: number;
  unlocks: Unlock[];
  today: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const buckets: Bucket[] = [
    { key: "cash", label: "Available now", note: "bank balances and matured CDs", value: cash, color: SERIES.bank },
    { key: "inv", label: "Within days", note: "brokerage — sell and settle", value: investments, color: SERIES.brokerage },
    { key: "cds", label: "Locked in CDs", note: "until each matures", value: cdsLocked, color: SERIES.cds },
    { key: "ret", label: "Retirement", note: "penalties before 59½", value: retirement, color: SERIES.retirement },
  ].filter((b) => b.value > 0);
  const total = buckets.reduce((s, b) => s + b.value, 0);
  if (total <= 0) return <p className="text-sm text-faint">Nothing to show yet.</p>;

  // Reachable (excluding retirement) today, then after each maturity.
  const start = cash + investments;
  const steps = [{ date: today, label: "Today", value: start, add: 0 }];
  for (const u of [...unlocks].sort((a, b) => a.date.localeCompare(b.date))) {
    const last = steps[steps.length - 1];
    if (last.date === u.date && steps.length > 1) {
      // Same-day maturities share one step.
      last.label += ` + ${u.label}`;
      last.value += u.value;
      last.add += u.value;
      continue;
    }
    steps.push({ date: u.date, label: u.label, value: last.value + u.value, add: u.value });
  }
  const t0 = new Date(today + "T00:00:00").getTime();
  const t1 = Math.max(
    new Date(steps[steps.length - 1].date + "T00:00:00").getTime(),
    t0 + 30 * 86_400_000
  );
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const max = Math.max(...steps.map((s) => s.value), 1) * 1.05;
  const x = (iso: string) =>
    PAD.left + ((new Date(iso + "T00:00:00").getTime() - t0) / (t1 - t0)) * plotW;
  const y = (v: number) => PAD.top + (1 - v / max) * plotH;
  const path = steps
    .map((s, i) => (i ? `H${x(s.date).toFixed(1)}V${y(s.value).toFixed(1)}` : `M${x(s.date)},${y(s.value)}`))
    .join("") + `H${W - PAD.right}`;
  const sel = hover != null ? steps[hover] : null;
  // Skip axis labels that would crowd the one before.
  let lastLabelX = -Infinity;
  const showLabel = steps.map((s) => {
    const px = x(s.date);
    if (px - lastLabelX < 46) return false;
    lastLabelX = px;
    return true;
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex h-3 w-full overflow-hidden rounded-sm" role="img" aria-label={buckets.map((b) => `${b.label} ${fmtUSD(b.value)}`).join(", ")}>
          {buckets.map((b, i) => (
            <div
              key={b.key}
              style={{
                width: `${(b.value / total) * 100}%`,
                background: b.color,
                marginLeft: i ? 2 : 0,
              }}
            />
          ))}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
          {buckets.map((b) => (
            <div key={b.key}>
              <dt className="flex items-center gap-1.5 text-xs text-faint">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: b.color }} />
                {b.label}
              </dt>
              <dd className="mt-0.5 text-prose tabular-nums">
                {fmtUSD(b.value, 0)}{" "}
                <span className="text-xs text-faint">{((b.value / total) * 100).toFixed(0)}%</span>
              </dd>
              <dd className="text-xs text-faint">{b.note}</dd>
            </div>
          ))}
        </dl>
      </div>

      {unlocks.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-4 text-xs text-faint">
            <span className="text-subtle">Reachable without touching retirement</span>
            {sel ? (
              <span className="tabular-nums">
                {sel.label} · {dateLabel(sel.date, true)} ·{" "}
                {sel.add > 0 && <>+{fmtUSD(sel.add, 0)} → </>}
                <span className="text-prose">{fmtUSD(sel.value, 0)}</span>
              </span>
            ) : (
              <span className="tabular-nums">
                {fmtUSD(start, 0)} today → <span className="text-prose">{fmtUSD(steps[steps.length - 1].value, 0)}</span> once every CD matures
              </span>
            )}
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Reachable money steps from ${fmtUSD(start, 0)} today to ${fmtUSD(steps[steps.length - 1].value, 0)} as CDs mature`} onMouseLeave={() => setHover(null)}>
            {[0, max / 2].map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={GRID} />
                <text x={PAD.left - 8} y={y(t) + 3.5} textAnchor="end" fontSize="11" fill={MUTED}>
                  {shortUSD(t)}
                </text>
              </g>
            ))}
            <path d={`${path}V${y(0)}H${PAD.left}Z`} fill={SERIES.bank} fillOpacity="0.1" />
            <path d={path} fill="none" stroke={SERIES.bank} strokeWidth="2" strokeLinejoin="round" />
            {steps.map((s, i) => (
              <g key={s.date + i} onMouseEnter={() => setHover(i)}>
                <circle cx={x(s.date)} cy={y(s.value)} r="14" fill="transparent" />
                <circle
                  cx={x(s.date)}
                  cy={y(s.value)}
                  r={hover === i ? 6 : 4.5}
                  fill={i ? SERIES.cds : SERIES.bank}
                  stroke={SURFACE}
                  strokeWidth="2"
                  style={{ pointerEvents: "none" }}
                />
                {(showLabel[i] || hover === i) && <text
                  x={x(s.date)}
                  y={H - 8}
                  textAnchor={x(s.date) > W - PAD.right - 24 ? "end" : "middle"}
                  fontSize="11"
                  fill={hover === i ? INK : MUTED}
                  style={{ pointerEvents: "none" }}
                >
                  {i ? dateLabel(s.date) : "Today"}
                </text>}
              </g>
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}
