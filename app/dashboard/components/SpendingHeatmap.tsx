"use client";

import { useState } from "react";
import { fmtUSD } from "./format";

const WEEKS = 26;
const CELL = 26;
const GAP = 3;
const LEFT = 34;
const TOP = 18;
const AVG_W = 120;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Sequential magenta (the spending hue), light → dark on the dark surface:
// empty, then four steps by quantile of the days that had spending.
const EMPTY = "#1c2620";
const STEPS = ["#4a2d3a", "#7a3d58", "#b0567d", "#e87ba4"];
const MUTED = "#8aa498";
const INK = "#deeade";
const BAR = "#e87ba4";

const DAY_MS = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

function quantile(sorted: number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[i];
}

/** Card spending by weekday (rows) and week (columns), with each weekday's average. */
export default function SpendingHeatmap({
  days,
  today,
}: {
  days: { date: string; total: number }[];
  today: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const byDate = new Map(days.map((d) => [d.date, d.total]));

  // Grid ends with the current week; weeks start on Monday.
  const t = new Date(today + "T00:00:00Z").getTime();
  const weekday = (new Date(t).getUTCDay() + 6) % 7;
  const firstMonday = t - weekday * DAY_MS - (WEEKS - 1) * 7 * DAY_MS;
  const cells: { date: string; w: number; d: number; total: number; future: boolean }[] = [];
  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < 7; d++) {
      const time = firstMonday + (w * 7 + d) * DAY_MS;
      const date = iso(time);
      cells.push({ date, w, d, total: byDate.get(date) ?? 0, future: time > t });
    }
  }
  const past = cells.filter((c) => !c.future);
  const spent = past.filter((c) => c.total > 0).map((c) => c.total).sort((a, b) => a - b);
  if (spent.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-faint">
        No card charges in the last {WEEKS} weeks. Import a statement under Manage →
        Spending to see when you spend.
      </p>
    );
  }
  const cuts = [0.25, 0.5, 0.75].map((q) => quantile(spent, q));
  const color = (v: number) =>
    v <= 0 ? EMPTY : STEPS[cuts.filter((c) => v > c).length];

  // Average per weekday over the weeks shown (days not yet reached excluded).
  const avg = DAYS.map((_, d) => {
    const ds = past.filter((c) => c.d === d);
    return ds.reduce((s, c) => s + c.total, 0) / Math.max(1, ds.length);
  });
  const maxAvg = Math.max(...avg, 1);
  const busiest = avg.indexOf(Math.max(...avg));
  const total = past.reduce((s, c) => s + c.total, 0);
  const sel = cells.find((c) => c.date === hover);

  const gridW = WEEKS * (CELL + GAP);
  const W = LEFT + gridW + 16 + AVG_W;
  const H = TOP + 7 * (CELL + GAP);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-[18px] flex-wrap items-baseline gap-x-4 text-xs text-faint">
        {sel ? (
          <span className="tabular-nums">
            {new Date(sel.date + "T00:00:00").toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}{" "}
            · <span className="text-prose">{sel.future ? "—" : fmtUSD(sel.total)}</span>
          </span>
        ) : (
          <span className="tabular-nums">
            Last {WEEKS} weeks · <span className="text-prose">{fmtUSD(total, 0)}</span> on cards ·
            most on <span className="text-prose">{DAYS[busiest]}s</span> (avg{" "}
            {fmtUSD(avg[busiest], 0)})
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          less
          {[EMPTY, ...STEPS].map((c) => (
            <span key={c} className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
          ))}
          more
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Card spending by day over the last ${WEEKS} weeks; most on ${DAYS[busiest]}s`}
        onMouseLeave={() => setHover(null)}
      >
        {DAYS.map((d, i) => (
          <text key={d} x={LEFT - 6} y={TOP + i * (CELL + GAP) + CELL / 2 + 4} textAnchor="end" fontSize="11" fill={MUTED}>
            {d}
          </text>
        ))}
        {Array.from({ length: WEEKS }, (_, w) => {
          const date = cells[w * 7].date;
          const firstOfMonth = w === 0 || date.slice(5, 7) !== cells[(w - 1) * 7].date.slice(5, 7);
          return firstOfMonth ? (
            <text key={w} x={LEFT + w * (CELL + GAP)} y={11} fontSize="11" fill={MUTED}>
              {new Date(date + "T00:00:00").toLocaleDateString("en-US", { month: "short" })}
            </text>
          ) : null;
        })}
        {cells.map((c) => (
          <rect
            key={c.date}
            x={LEFT + c.w * (CELL + GAP)}
            y={TOP + c.d * (CELL + GAP)}
            width={CELL}
            height={CELL}
            rx="3"
            fill={c.future ? "transparent" : color(c.total)}
            stroke={hover === c.date ? INK : c.future ? "#243028" : "none"}
            strokeWidth={hover === c.date ? 1.5 : 1}
            onMouseEnter={() => setHover(c.date)}
          />
        ))}
        {avg.map((a, d) => {
          const x0 = LEFT + gridW + 16;
          const y0 = TOP + d * (CELL + GAP);
          const w = (a / maxAvg) * (AVG_W - 46);
          return (
            <g key={d}>
              <rect x={x0} y={y0 + CELL / 2 - 4} width={Math.max(w, a > 0 ? 2 : 0)} height="8" rx="2" fill={BAR} opacity={d === busiest ? 1 : 0.6} />
              <text x={x0 + w + 6} y={y0 + CELL / 2 + 4} fontSize="11" fill={MUTED} style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmtUSD(a, 0)}
              </text>
            </g>
          );
        })}
        <text x={LEFT + gridW + 16} y={11} fontSize="11" fill={MUTED}>
          avg / day
        </text>
      </svg>
      <p className="text-xs text-faint">Card charges only — bills aren&apos;t tied to a day, so they&apos;re left out.</p>
    </div>
  );
}
