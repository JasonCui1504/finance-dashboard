"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DELTA_DOWN, DELTA_UP, fmtPct, fmtUSD } from "./format";
import { prefersReducedMotion } from "./motion";

function useCountUp(target: number, duration = 700): number {
  // Starts at 0 so the number counts up on mount; every update happens inside a
  // requestAnimationFrame callback (never synchronously in the effect body).
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      const raf = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(raf);
    }
    const from = fromRef.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (target - from) * eased;
      fromRef.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const W = 120;
  const H = 32;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * W,
    y: 3 + (1 - (v - min) / span) * (H - 6),
  }));
  const path = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join("");
  const gid = `spark-${color.replace("#", "")}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-8 w-full" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={`${path}L${W},${H}L0,${H}Z`}
        fill={`url(#${gid})`}
        className="fin-fade"
      />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        pathLength={1}
        className="fin-draw"
      />
    </svg>
  );
}

export default function StatTile({
  label,
  value,
  deltaPct,
  spark,
  color,
  hero = false,
  delay = 0,
  href,
}: {
  label: string;
  value: number;
  deltaPct?: number | null;
  spark?: number[];
  color?: string;
  hero?: boolean;
  delay?: number;
  href?: string;
}) {
  const display = useCountUp(value);

  const cls =
    "fin-card fin-rise group relative block overflow-hidden rounded-xl border border-line bg-surface p-5";

  const inner = (
    <>
      {hero && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, var(--accent) 50%, transparent)",
          }}
        />
      )}
      {href && (
        <span
          aria-hidden
          className="absolute right-4 top-4 text-faint transition-colors group-hover:text-subtle"
        >
          →
        </span>
      )}
      <p className="text-xs text-faint">{label}</p>
      <p
        className={`mt-1 ${hero ? "text-3xl" : "text-2xl"}`}
        style={
          hero
            ? {
                background: "linear-gradient(180deg, #ffffff 20%, var(--subtle))",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }
            : { color: "var(--prose)" }
        }
      >
        {fmtUSD(display)}
      </p>
      {deltaPct != null && (
        <p
          className="mt-1 text-sm"
          style={{ color: deltaPct >= 0 ? DELTA_UP : DELTA_DOWN }}
        >
          {fmtPct(deltaPct)} today
        </p>
      )}
      {spark && spark.length > 1 && (
        <div className="mt-3">
          <Sparkline data={spark} color={color ?? "#3987e5"} />
        </div>
      )}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={cls} style={{ animationDelay: `${delay}ms` }}>
        {inner}
      </Link>
    );
  }
  return (
    <section className={cls} style={{ animationDelay: `${delay}ms` }}>
      {inner}
    </section>
  );
}
