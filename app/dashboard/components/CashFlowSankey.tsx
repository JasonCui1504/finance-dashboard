"use client";

import { useState } from "react";
import { fmtUSD } from "./format";

export type FlowPeriod = {
  key: string;
  label: string;
  gross: number;
  tax: number;
  net: number;
  categories: { name: string; total: number }[];
};

type Node = { id: string; label: string; col: number; value: number; color: string };
type Link = { source: string; target: string; value: number };

const W = 800;
const NODE_W = 10;
const GAP = 10;
const COL_X = [150, 400, 590];
const PAD_Y = 8;
const LABEL_H = 30;
const NET = "#17a06b";
const TAX = "#d9730d";
const SPEND = "#e87ba4";
const SAVED = "#3987e5";
const DEFICIT = "#e66767";
const INK = "#deeade";
const MUTED = "#8aa498";
const SURFACE = "#141c17";

/** Gross pay → taxes and take-home → bills, each spending category, and what's left. */
export default function CashFlowSankey({ periods }: { periods: FlowPeriod[] }) {
  const [key, setKey] = useState(periods[0]?.key);
  const [hover, setHover] = useState<string | null>(null);
  const p = periods.find((x) => x.key === key) ?? periods[0];
  if (!p || p.gross <= 0) {
    return (
      <p className="py-8 text-center text-sm text-faint">
        Log paychecks under Manage → Income to see where your pay goes.
      </p>
    );
  }

  const cats = p.categories.filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
  const spend = cats.reduce((s, c) => s + c.total, 0);
  const saved = p.net - spend;
  const deficit = Math.max(0, -saved);

  const nodes: Node[] = [
    { id: "gross", label: "Gross pay", col: 0, value: p.gross, color: NET },
    ...(deficit > 0 ? [{ id: "deficit", label: "From savings", col: 0, value: deficit, color: DEFICIT }] : []),
    { id: "tax", label: "Taxes", col: 1, value: p.tax, color: TAX },
    {
      id: "net",
      label: deficit > 0 ? "Take-home + savings" : "Take-home",
      col: 1,
      value: p.net + deficit,
      color: NET,
    },
    ...cats.map((c) => ({ id: `cat:${c.name}`, label: c.name, col: 2, value: c.total, color: SPEND })),
    ...(saved > 0 ? [{ id: "saved", label: "Saved", col: 2, value: saved, color: SAVED }] : []),
  ].filter((n) => n.value > 0);
  const links: Link[] = [
    { source: "gross", target: "tax", value: p.tax },
    { source: "gross", target: "net", value: p.net },
    { source: "deficit", target: "net", value: deficit },
    ...cats.map((c) => ({ source: "net", target: `cat:${c.name}`, value: c.total })),
    { source: "net", target: "saved", value: Math.max(0, saved) },
  ].filter((l) => l.value > 0);

  // Scale so the busiest column (most nodes → most gaps) fits.
  const cols = [0, 1, 2].map((c) => nodes.filter((n) => n.col === c));
  const H = Math.max(240, cols[2].length * 38 + PAD_Y * 2);
  const k = Math.min(
    ...cols.map((ns) => {
      const total = ns.reduce((s, n) => s + n.value, 0);
      return total > 0 ? (H - PAD_Y * 2 - GAP * (ns.length - 1)) / total : Infinity;
    })
  );
  // Every node keeps room for its two-line label, even when its band is
  // thin; the chart grows taller rather than letting labels collide.
  const pos = new Map<string, { y: number; h: number }>();
  let bottom = H;
  for (const ns of cols) {
    let y = PAD_Y;
    for (const n of ns) {
      const h = Math.max(2, n.value * k);
      pos.set(n.id, { y, h });
      y += Math.max(h, LABEL_H) + GAP;
    }
    bottom = Math.max(bottom, y - GAP + PAD_Y);
  }

  // Link bands, stacked along each node's out- and in-edges in link order.
  const outOff = new Map<string, number>();
  const inOff = new Map<string, number>();
  const nodeOf = new Map(nodes.map((n) => [n.id, n]));
  const bands = links.map((l) => {
    const s = nodeOf.get(l.source)!;
    const t = nodeOf.get(l.target)!;
    const h = Math.max(1, l.value * k);
    const sy = pos.get(s.id)!.y + (outOff.get(s.id) ?? 0);
    const ty = pos.get(t.id)!.y + (inOff.get(t.id) ?? 0);
    outOff.set(s.id, (outOff.get(s.id) ?? 0) + h);
    inOff.set(t.id, (inOff.get(t.id) ?? 0) + h);
    const x0 = COL_X[s.col] + NODE_W;
    const x1 = COL_X[t.col];
    const xm = (x0 + x1) / 2;
    const d = `M${x0},${sy}C${xm},${sy} ${xm},${ty} ${x1},${ty}V${ty + h}C${xm},${ty + h} ${xm},${sy + h} ${x0},${sy + h}Z`;
    return { ...l, d, color: t.color };
  });

  const lit = (id: string) => hover == null || hover === id;
  const linkLit = (l: Link) => hover == null || hover === l.source || hover === l.target;
  const pctOfNet = (v: number) => (p.net > 0 ? `${((v / p.net) * 100).toFixed(0)}%` : "");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-faint">
        <select
          value={p.key}
          onChange={(e) => setKey(e.target.value)}
          className="rounded border border-line bg-canvas px-2 py-1 text-xs text-prose outline-none focus:border-accent"
        >
          {periods.map((x) => (
            <option key={x.key} value={x.key}>
              {x.label}
            </option>
          ))}
        </select>
        <span className="tabular-nums">
          Spent <span className="text-prose">{fmtUSD(spend, 0)}</span> of{" "}
          {fmtUSD(p.net, 0)} take-home ·{" "}
          {saved >= 0 ? (
            <>
              saved <span style={{ color: SAVED }}>{fmtUSD(saved, 0)}</span> ({pctOfNet(saved)})
            </>
          ) : (
            <span style={{ color: DEFICIT }}>{fmtUSD(deficit, 0)} more than take-home</span>
          )}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${bottom}`}
        className="w-full"
        role="img"
        aria-label={`Of ${fmtUSD(p.gross, 0)} gross pay, ${fmtUSD(p.tax, 0)} to taxes, ${fmtUSD(spend, 0)} spent, ${saved >= 0 ? `${fmtUSD(saved, 0)} saved` : `${fmtUSD(deficit, 0)} drawn from savings`}`}
        onMouseLeave={() => setHover(null)}
      >
        {bands.map((b, i) => (
          <path
            key={i}
            d={b.d}
            fill={b.color}
            fillOpacity={linkLit(b) ? 0.35 : 0.08}
            style={{ transition: "fill-opacity 0.15s" }}
          />
        ))}
        {nodes.map((n) => {
          const { y, h } = pos.get(n.id)!;
          const x = COL_X[n.col];
          const right = n.col === 2 || n.id === "tax";
          const tx = right ? x + NODE_W + 8 : x - 8;
          const ty = y + h / 2;
          return (
            <g key={n.id} onMouseEnter={() => setHover(n.id)} style={{ cursor: "default" }}>
              <rect x={x - 4} y={y - 4} width={NODE_W + 8} height={h + 8} fill="transparent" />
              <rect x={x} y={y} width={NODE_W} height={h} rx="2" fill={n.color} opacity={lit(n.id) ? 1 : 0.4} />
              <text
                x={tx}
                y={ty - 1}
                textAnchor={right ? "start" : "end"}
                fontSize="12"
                fill={INK}
                stroke={SURFACE}
                strokeWidth="3"
                paintOrder="stroke"
                style={{ pointerEvents: "none" }}
              >
                {n.label}
              </text>
              <text
                x={tx}
                y={ty + 13}
                textAnchor={right ? "start" : "end"}
                fontSize="11"
                fill={MUTED}
                stroke={SURFACE}
                strokeWidth="3"
                paintOrder="stroke"
                style={{ pointerEvents: "none", fontVariantNumeric: "tabular-nums" }}
              >
                {fmtUSD(n.value, 0)}
                {n.col === 2 ? ` · ${pctOfNet(n.value)}` : ""}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
