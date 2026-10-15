"use client";

import { useState } from "react";
import CashFlowSankey, { type FlowPeriod } from "./CashFlowSankey";
import SpendingHeatmap from "./SpendingHeatmap";

const VIEWS = [
  { key: "flow", label: "Where it goes" },
  { key: "when", label: "When you spend" },
] as const;

/** The Sankey and the spending heatmap, sharing one card behind a switch. */
export default function CashFlowViews({
  periods,
  days,
  today,
}: {
  periods: FlowPeriod[];
  days: { date: string; total: number }[];
  today: string;
}) {
  const [view, setView] = useState<(typeof VIEWS)[number]["key"]>("flow");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`rounded px-2.5 py-1 text-xs transition-colors ${
              view === v.key ? "bg-lift text-prose" : "text-faint hover:text-subtle"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === "flow" ? (
        <CashFlowSankey periods={periods} />
      ) : (
        <SpendingHeatmap days={days} today={today} />
      )}
    </div>
  );
}
