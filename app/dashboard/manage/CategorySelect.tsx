"use client";

import { useCallback, useEffect, useState } from "react";

export type TaxonomyGroup = { id: number; slug: string | null; name: string };
export type TaxonomyCategory = { id: number; group_id: number; slug: string | null; name: string };
export type Taxonomy = { groups: TaxonomyGroup[]; categories: TaxonomyCategory[] };

/** The editable groups + categories, reloadable after a rename. */
export function useTaxonomy() {
  const [taxonomy, setTaxonomy] = useState<Taxonomy>({ groups: [], categories: [] });
  const reload = useCallback(() => {
    fetch("/api/finance/categories")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Taxonomy | null) => d && setTaxonomy(d))
      .catch(() => {});
  }, []);
  useEffect(reload, [reload]);
  return { taxonomy, reload };
}

/** Category picker grouped under Fixed / Essentials / …, plus Uncategorized. */
export default function CategorySelect({
  value,
  onChange,
  taxonomy,
  className,
  noneLabel = "Uncategorized",
  ariaLabel,
  only,
}: {
  value: number | null;
  onChange: (id: number | null) => void;
  taxonomy: Taxonomy;
  className?: string;
  noneLabel?: string;
  ariaLabel?: string;
  /** Limit to one group's categories (e.g. Fixed for bills). */
  only?: number;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value == null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className={className}
    >
      <option value="">{noneLabel}</option>
      {taxonomy.groups
        .filter((g) => only == null || g.id === only)
        .map((g) => (
          <optgroup key={g.id} label={g.name}>
            {taxonomy.categories
              .filter((c) => c.group_id === g.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </optgroup>
        ))}
    </select>
  );
}
