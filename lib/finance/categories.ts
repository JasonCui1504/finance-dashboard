// Canonical spending categories + a keyword categorizer. This module has no
// server-only dependencies so it can run in the browser during statement import.

export const CATEGORIES = [
  "Groceries",
  "Dining",
  "Transport",
  "Shopping",
  "Bills",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

// First match wins, so order matters: a merchant caught by an earlier rule
// never reaches a later one (Costco fuel reads as Groceries, Amazon Prime
// Video as Shopping).
const RULES: [RegExp, Category][] = [
  [/whole foods|trader joe|safeway|kroger|costco|aldi|grocer|supermarket|wegmans|publix|h-?e-?b|sprouts|instacart/i, "Groceries"],
  [/restaurant|caf[eé]|coffee|starbucks|mcdonald|chipotle|doordash|uber eats|grubhub|dining|pizza|sushi|grill|taco|deli|bakery|dunkin|panera|jamba|smoothie|juice|burger king|\bkfc\b|wendy|popeyes|chick-?fil|shake shack|five guys|in-?n-?out|cava|sweetgreen|panda express|noodle|ramen|\bpho\b|eatery|kitchen|brewery|\bbar\b/i, "Dining"],
  [/uber|lyft|shell|chevron|exxon|mobil|\bgas\b|fuel|parking|transit|\bmetro\b|\bbart\b|toll|amtrak|caltrain|didi|\bgrab\b|\bmtr\b|\bmrt\b|subway station|airline|delta air|united air|american air|southwest|jetblue|alaska air|hotel|airbnb|expedia|marriott|hilton|hyatt|travel|booking\.com|vrbo/i, "Transport"],
  [/amazon|target|walmart|best buy|ebay|etsy|nike|apple store|ikea|home depot|lowe'?s|macy|nordstrom|\bstore\b/i, "Shopping"],
  [/electric|water district|comcast|xfinity|spectrum|verizon|at&t|t-mobile|utility|pg&e|internet|\bpower\b|sewer|waste management|netflix|spotify|hulu|disney ?\+|disney plus|hbo|max\.com|youtube premium|patreon|prime video|icloud|apple\.com\/bill|dropbox|nyt|new york times|substack|audible|adobe|github|notion|openai|chatgpt|anthropic|claude\.ai|\bfee\b|interest charge|annual membership|late payment|finance charge|service charge/i, "Bills"],
];

// Issuer boilerplate that carries no merchant signal. Amex tags every online
// transaction "INTERNET CHARGE", which otherwise reads as an ISP bill and
// drags App Store charges into Utilities.
const DESCRIPTION_NOISE =
  /\binternet charge\b|\baplpay\b|\bapple pay\b|\bsq \*|\btst\* |\bpos debit\b|\brecurring payment\b/gi;

/** Best-guess category from a transaction description. */
export function categorize(description: string): Category {
  const cleaned = description.replace(DESCRIPTION_NOISE, " ");
  for (const [re, cat] of RULES) if (re.test(cleaned)) return cat;
  return "Other";
}

/** Map an issuer-provided category string onto our canonical set. */
export function normalizeIssuerCategory(raw: string): Category | null {
  const s = raw.toLowerCase();
  if (/grocery|groceries/.test(s)) return "Groceries";
  if (/dining|restaurant|food/.test(s)) return "Dining";
  if (/gas|transport|automotive|travel|airline|lodging|hotel/.test(s)) return "Transport";
  if (/merchandise|shopping|retail/.test(s)) return "Shopping";
  if (/utilit|phone|cable|bills|fee|interest|subscription/.test(s)) return "Bills";
  // Entertainment and health no longer have a home of their own; let the
  // description rules try, and fall to Other if they find nothing.
  return null;
}

/**
 * Description reduced to something comparable across statements: lowercased,
 * issuer boilerplate removed, `*` treated as a separator, whitespace collapsed.
 * Store numbers and order refs survive here and are dropped by merchantKey.
 */
export function normalizeDescription(description: string): string {
  return description
    .replace(DESCRIPTION_NOISE, " ")
    .toLowerCase()
    .replace(/\*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Default match key for a learned rule — the leading words with anything
 * carrying a digit dropped, so "SAFEWAY 0923" and "SAFEWAY 1184" share a key.
 * Kept to two words; a rule can be widened or narrowed by editing it.
 */
export function merchantKey(description: string): string {
  const words = normalizeDescription(description)
    .split(" ")
    // Strip digit runs rather than dropping the whole word, or a descriptor
    // like HOTELCOM720789320459HOTELS.COM loses its merchant entirely and the
    // key collapses onto the trailing state code.
    .map((w) => w.replace(/\d+/g, "").replace(/^[^a-z]+|[^a-z.&/]+$/g, ""))
    // Three characters filters out state codes and leftovers like "t-".
    .filter((w) => w.length >= 3);
  return words.slice(0, 2).join(" ");
}

/** A rule matches when the normalized description starts with its key. */
export function matchMerchantRule<T extends { match_key: string; category: string }>(
  description: string,
  rules: T[]
): T | null {
  const normalized = normalizeDescription(description);
  // Longest key first, so a narrow rule beats a broad one.
  const sorted = [...rules].sort((a, b) => b.match_key.length - a.match_key.length);
  return sorted.find((r) => normalized.startsWith(r.match_key)) ?? null;
}

const CATEGORY_SET = new Set<string>(CATEGORIES);
export function isCategory(value: string): value is Category {
  return CATEGORY_SET.has(value);
}
