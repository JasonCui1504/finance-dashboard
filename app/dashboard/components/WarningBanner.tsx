"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DashboardWarning } from "../../../lib/finance/queries";

/** Pinned notes at the top of the dashboard, each kept until removed. */
export default function WarningBanner({ warnings }: { warnings: DashboardWarning[] }) {
  const router = useRouter();
  const [removing, setRemoving] = useState<number | null>(null);

  async function remove(id: number) {
    setRemoving(id);
    try {
      const res = await fetch(`/api/finance/warnings/${id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setRemoving(null);
    }
  }

  if (warnings.length === 0) return null;
  return (
    <ul
      className="fin-rise flex flex-col rounded-lg border px-4 py-1 text-sm"
      style={{ borderColor: "#fab21955", background: "#fab21912" }}
    >
      {warnings.map((w) => (
        <li
          key={w.id}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line py-2 first:border-t-0"
        >
          <span aria-hidden>⚠️</span>
          <span className="min-w-0 flex-1 text-subtle">{w.text}</span>
          <button
            type="button"
            onClick={() => remove(w.id)}
            disabled={removing === w.id}
            className="whitespace-nowrap text-xs text-faint transition-colors hover:text-prose disabled:opacity-50"
          >
            Remove warning
          </button>
        </li>
      ))}
    </ul>
  );
}
