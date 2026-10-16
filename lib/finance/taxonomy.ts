import { categorizeSlug } from "./categories";
import { getDb } from "./db";

export type SpendingGroup = {
  id: number;
  /** Set for the built-in groups ("fixed", …); survives renaming. */
  slug: string | null;
  name: string;
  sort_order: number;
};

export type SpendingCategory = {
  id: number;
  group_id: number;
  /** Set for the built-in categories; the keyword rules point at it. */
  slug: string | null;
  name: string;
  sort_order: number;
};

export type Taxonomy = { groups: SpendingGroup[]; categories: SpendingCategory[] };

/** Every group and category, in display order. */
export async function getTaxonomy(): Promise<Taxonomy> {
  const db = await getDb();
  const [g, c] = await Promise.all([
    db.execute("SELECT * FROM spending_groups ORDER BY sort_order, id"),
    db.execute("SELECT * FROM spending_categories ORDER BY sort_order, id"),
  ]);
  return {
    groups: g.rows.map((r) => ({
      id: Number(r.id),
      slug: r.slug == null ? null : String(r.slug),
      name: String(r.name),
      sort_order: Number(r.sort_order),
    })),
    categories: c.rows.map((r) => ({
      id: Number(r.id),
      group_id: Number(r.group_id),
      slug: r.slug == null ? null : String(r.slug),
      name: String(r.name),
      sort_order: Number(r.sort_order),
    })),
  };
}

export type SpendingBudget = {
  id: number;
  group_id: number | null;
  category_id: number | null;
  monthly_limit: number;
};

export async function listSpendingBudgets(): Promise<SpendingBudget[]> {
  const db = await getDb();
  const rs = await db.execute("SELECT * FROM spending_budgets ORDER BY id");
  return rs.rows.map((r) => ({
    id: Number(r.id),
    group_id: r.group_id == null ? null : Number(r.group_id),
    category_id: r.category_id == null ? null : Number(r.category_id),
    monthly_limit: Number(r.monthly_limit),
  }));
}

/** A category id that exists, or null; `undefined` input means "not given". */
export async function resolveCategoryId(raw: unknown): Promise<number | null | "invalid"> {
  if (raw == null || raw === "") return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return "invalid";
  const db = await getDb();
  const rs = await db.execute({ sql: "SELECT id FROM spending_categories WHERE id = ?", args: [id] });
  return rs.rows.length ? id : "invalid";
}

/** Name of a category for the text mirror column ("Uncategorized" for none). */
export async function categoryLabel(id: number | null): Promise<string> {
  if (id == null) return "Uncategorized";
  const db = await getDb();
  const rs = await db.execute({ sql: "SELECT name FROM spending_categories WHERE id = ?", args: [id] });
  return rs.rows.length ? String(rs.rows[0].name) : "Uncategorized";
}

/** Bills are fixed costs: a Fixed category guessed from the name. */
export async function guessBillCategoryId(name: string): Promise<number | null> {
  const db = await getDb();
  const rs = await db.execute(
    `SELECT c.id, c.slug FROM spending_categories c
     JOIN spending_groups g ON g.id = c.group_id WHERE g.slug = 'fixed'`
  );
  const bySlug = new Map(rs.rows.map((r) => [String(r.slug), Number(r.id)]));
  const guess = categorizeSlug(name);
  return (guess && bySlug.get(guess)) ?? bySlug.get("utilities") ?? null;
}
