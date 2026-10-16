"use client";

import { useEffect, useId, useState } from "react";
import { fmtUSD } from "./format";
import { prefersReducedMotion } from "./motion";

export type SpendBucket = {
  /** First and last day covered, YYYY-MM-DD. */
  start: string;
  end: string;
  /** Card purchases (≥ 0). */
  spent: number;
  /** Bills and manual monthly card totals, counted on the 1st of their month (≥ 0). */
  fixed: number;
  /** Returns and credits (≤ 0). */
  returned: number;
};

const W = 800;
const H = 240;
const PAD = { top: 16, right: 12, bottom: 28, left: 56 };
// Dark-mode steps validated against the card surface (dataviz palette check).
export const SPENT_COLOR = "#d55181";
export const RETURNED_COLOR = "#3987e5";
// Bills and monthly totals aren't card purchases: a muted neutral with a
// hatch keeps them visibly apart.
export const FIXED_COLOR = "#8aa498";
const GRID = "#243028";
const MUTED = "#8aa498";
const INK = "#deeade";

function shortUSD(v: number): string {
  const a = Math.abs(v);
  const s = a >= 1_000 ? `$${(a / 1_000).toFixed(a >= 10_000 ? 0 : 1)}k` : `$${Math.round(a)}`;
  return v < 0 ? `−${s}` : s;
}

export function shortDate(d: string): string {
  return new Date(d + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function bucketLabel(b: SpendBucket): string {
  return b.start === b.end ? shortDate(b.start) : `${shortDate(b.start)} – ${shortDate(b.end)}`;
}

/**
 * Spending over a date range in buckets of a few days: card purchases rise
 * above the baseline on top of bills and monthly totals, returns and
 * credits hang below it, so a refund shows up where it landed instead of
 * silently shrinking a month. Days after the newest imported statement are
 * shaded, so a gap reads as "not imported yet" rather than "spent nothing".
 */
export default function SpendingRangeChart({
  buckets,
  lastImported,
}: {
  buckets: SpendBucket[];
  /** Date of the newest imported card transaction, if any. */
  lastImported: string | null;
}) {
  const hatchId = `fixed-hatch-${useId().replace(/:/g, "")}`;
  const [{ grown, instant }, setAnim] = useState({ grown: false, instant: false });
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const reduced = prefersReducedMotion();
    const raf = requestAnimationFrame(() => setAnim({ grown: true, instant: reduced }));
    return () => cancelAnimationFrame(raf);
  }, []);

  const maxUp = Math.max(...buckets.map((b) => b.spent + b.fixed), 0);
  const maxDown = Math.max(...buckets.map((b) => -b.returned), 0);
  if (buckets.length === 0 || (maxUp === 0 && maxDown === 0)) {
    return <p className="py-8 text-center text-sm text-faint">No card activity in this range.</p>;
  }

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  // Returns get at least a sliver of room so the axis reads as a baseline.
  const top = maxUp || 1;
  const bottom = maxDown;
  const y = (v: number) => PAD.top + ((top - v) / (top + bottom)) * plotH;
  const zero = y(0);
  const slot = plotW / buckets.length;
  const gap = Math.min(2, slot * 0.25);
  const barW = Math.max(1, Math.min(40, slot - gap));
  // The returns tick only when there's room below the baseline for its label.
  const ticks = [top, top / 2, 0, ...(bottom > 0 && y(-bottom) - zero >= 14 ? [-bottom] : [])];
  // About six date labels, whatever the bucket count.
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 6));
  const transition = instant
    ? "opacity 0.15s"
    : "height 0.5s cubic-bezier(0.4,0,0.2,1), y 0.5s cubic-bezier(0.4,0,0.2,1), opacity 0.15s";
  const sel = hover != null ? buckets[hover] : null;
  // First bucket wholly after the newest statement; everything from it on is shaded.
  const firstMissing =
    lastImported == null ? -1 : buckets.findIndex((b) => b.start > lastImported);
  const shadeX = firstMissing >= 0 ? PAD.left + slot * firstMissing : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-[18px] flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-faint">
        {sel ? (
          <>
            <span className="text-prose">{bucketLabel(sel)}</span>
            <span className="tabular-nums">
              <span className="text-prose">{fmtUSD(sel.spent)}</span> card purchases
            </span>
            {sel.fixed > 0 && (
              <span className="tabular-nums">
                <span className="text-prose">{fmtUSD(sel.fixed)}</span> bills &amp; monthly
              </span>
            )}
            {sel.returned !== 0 && (
              <span className="tabular-nums">
                <span className="text-prose">{fmtUSD(-sel.returned)}</span> returned
              </span>
            )}
            <span className="tabular-nums">
              net <span className="text-prose">{fmtUSD(sel.spent + sel.fixed + sel.returned)}</span>
            </span>
          </>
        ) : (
          <span>
            Hover a bar for its dates and amounts
            {shadeX != null && lastImported && (
              <> · no statements imported after {shortDate(lastImported)}</>
            )}
          </span>
        )}
        <span className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SPENT_COLOR }} aria-hidden />
            Card purchases
          </span>
          <span className="flex items-center gap-1.5">
            <svg className="h-2.5 w-2.5" viewBox="0 0 10 10" aria-hidden>
              <rect width="10" height="10" rx="2" fill={FIXED_COLOR} fillOpacity="0.25" />
              <path d="M-2,8 L8,-2 M2,12 L12,2" stroke={FIXED_COLOR} strokeWidth="1.6" />
            </svg>
            Bills &amp; monthly totals
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: RETURNED_COLOR }} aria-hidden />
            Returns &amp; credits
          </span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Spending in ${buckets.length} periods from ${shortDate(buckets[0].start)} to ${shortDate(
          buckets[buckets.length - 1].end
        )}`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill={FIXED_COLOR} fillOpacity="0.22" />
            <line x1="0" y1="0" x2="0" y2="6" stroke={FIXED_COLOR} strokeWidth="2" strokeOpacity="0.8" />
          </pattern>
        </defs>
        {shadeX != null && (
          <g>
            <rect
              x={shadeX}
              y={PAD.top}
              width={W - PAD.right - shadeX}
              height={plotH}
              fill={INK}
              fillOpacity="0.035"
            />
            <line
              x1={shadeX}
              x2={shadeX}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke={MUTED}
              strokeOpacity="0.6"
              strokeDasharray="3 3"
            />
            {W - PAD.right - shadeX >= 130 && (
              // Right-aligned with a surface halo, so a bill landing on the
              // 1st inside the shaded area can't swallow it.
              <text
                x={W - PAD.right - 6}
                y={PAD.top + 12}
                textAnchor="end"
                fontSize="11"
                fill={MUTED}
                stroke="#141c17"
                strokeWidth="4"
                strokeLinejoin="round"
                paintOrder="stroke"
              >
                No statements imported yet
              </text>
            )}
          </g>
        )}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? MUTED : GRID}
              strokeOpacity={t === 0 ? 0.5 : 1}
              strokeWidth="1"
            />
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
        {buckets.map((b, i) => {
          const x = PAD.left + slot * i + (slot - barW) / 2;
          const fixedH = grown ? zero - y(b.fixed) : 0;
          // Purchases stack on the fixed layer with a 2px surface gap.
          const gapPx = b.fixed > 0 && b.spent > 0 ? 2 : 0;
          const upH = grown ? Math.max(0, zero - y(b.spent) - gapPx) : 0;
          const downH = grown ? y(b.returned) - zero : 0;
          const active = hover === i;
          const r = Math.min(3, barW / 2);
          return (
            <g key={b.start}>
              {/* the whole column is the hit target, not just the painted bar */}
              <rect
                x={PAD.left + slot * i}
                y={PAD.top}
                width={slot}
                height={plotH}
                fill={active ? INK : "transparent"}
                fillOpacity={active ? 0.04 : 0}
                onMouseEnter={() => setHover(i)}
              />
              {b.fixed > 0 && (
                <rect
                  x={x}
                  y={zero - fixedH}
                  width={barW}
                  height={fixedH}
                  rx={b.spent > 0 ? Math.min(1, r) : r}
                  fill={`url(#${hatchId})`}
                  opacity={hover == null || active ? 1 : 0.55}
                  style={{ pointerEvents: "none", transition }}
                />
              )}
              {b.spent > 0 && (
                <rect
                  x={x}
                  y={zero - fixedH - gapPx - upH}
                  width={barW}
                  height={upH}
                  rx={r}
                  fill={SPENT_COLOR}
                  opacity={hover == null || active ? 1 : 0.55}
                  style={{ pointerEvents: "none", transition }}
                />
              )}
              {b.returned < 0 && (
                <rect
                  x={x}
                  y={zero}
                  width={barW}
                  height={downH}
                  rx={r}
                  fill={RETURNED_COLOR}
                  opacity={hover == null || active ? 1 : 0.55}
                  style={{ pointerEvents: "none", transition }}
                />
              )}
              {(buckets.length - 1 - i) % labelEvery === 0 && (
                <text
                  x={PAD.left + slot * i + slot / 2}
                  y={H - 9}
                  textAnchor="middle"
                  fontSize="11"
                  fill={active ? INK : MUTED}
                >
                  {shortDate(b.end)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
