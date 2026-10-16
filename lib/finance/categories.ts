// Spending taxonomy defaults + keyword categorizer. This module has no
// server-only dependencies so it can run in the browser during statement import.
//
// Groups and categories live in the database (spending_groups /
// spending_categories) so their labels can be renamed under Manage. The
// built-in ones also carry a fixed slug, which is what the keyword and issuer
// rules below point at — renaming "Dining" to "Eating out" never breaks them.

export const DEFAULT_GROUPS = [
  { slug: "fixed", name: "Fixed" },
  { slug: "essentials", name: "Essentials" },
  { slug: "travel", name: "Travel" },
  { slug: "lifestyle", name: "Lifestyle" },
] as const;

export const DEFAULT_CATEGORIES = [
  { slug: "housing", name: "Housing", group: "fixed" },
  { slug: "utilities", name: "Utilities & phone", group: "fixed" },
  { slug: "subscriptions", name: "Subscriptions", group: "fixed" },
  { slug: "insurance", name: "Insurance", group: "fixed" },
  { slug: "groceries", name: "Groceries", group: "essentials" },
  { slug: "getting_around", name: "Getting around", group: "essentials" },
  { slug: "health", name: "Health", group: "essentials" },
  { slug: "household", name: "Household", group: "essentials" },
  { slug: "flights", name: "Flights", group: "travel" },
  { slug: "lodging", name: "Lodging", group: "travel" },
  { slug: "car_rental", name: "Car rental", group: "travel" },
  { slug: "trip_extras", name: "Trip extras", group: "travel" },
  { slug: "dining", name: "Dining", group: "lifestyle" },
  { slug: "shopping", name: "Shopping", group: "lifestyle" },
  { slug: "fun", name: "Fun", group: "lifestyle" },
] as const;

export type CategorySlug = (typeof DEFAULT_CATEGORIES)[number]["slug"];

/** Label for transactions no rule could place. Not a stored category. */
export const UNCATEGORIZED = "Uncategorized";

// First match wins, so order matters: travel comes before everyday transport
// (an airline isn't "getting around"), insurance after trip extras (travel
// insurance is a trip cost), subscriptions before shopping (Amazon Prime vs
// Amazon), and dining before getting around (Uber Eats vs Uber).
const RULES: [RegExp, CategorySlug][] = [
  [/hertz|\bavis\b|enterprise rent|budget rent|national car|alamo|\bsixt\b|\bturo\b|thrifty|dollar rent|car rental|rental car|rent a car/i, "car_rental"],
  [/airline|airways|air lines|delta air|united air|american air|southwest|jetblue|alaska air|spirit air|frontier air|hawaiian air|air canada|lufthansa|british air|emirates|qatar air|\bklm\b|air france|japan airlines|cathay|singapore air|eva air|korean air|ryanair|easyjet|aeromexico|volaris|airfare/i, "flights"],
  [/hotel|marriott|hilton|hyatt|airbnb|vrbo|\bihg\b|holiday inn|sheraton|westin|four seasons|motel|resort|hostel|booking\.com|expedia/i, "lodging"],
  [/baggage|bag fee|travel insurance|tsa ?pre|global entry|clear ?me|priority pass|duty free|inflight|in-flight|gogo air/i, "trip_extras"],
  [/insurance|geico|state farm|progressive ins|allstate|lemonade|liberty mutual|farmers ins|nationwide ins/i, "insurance"],
  [/\brent\b|mortgage|apartment|property management|\bhoa\b|leasing office|landlord/i, "housing"],
  [/electric|water district|comcast|xfinity|spectrum|verizon|at&t|t-mobile|mint mobile|google fi|utility|utilities|pg&e|edison|con ?ed\b|internet service|sewer|waste management|\bpower\b/i, "utilities"],
  [/netflix|spotify|hulu|disney ?\+|disney plus|hbo|max\.com|youtube premium|patreon|prime video|amazon prime|icloud|apple\.com\/bill|apple music|dropbox|\bnyt\b|new york times|substack|audible|adobe|github|notion|openai|chatgpt|anthropic|claude\.ai|peloton|\bgym\b|fitness|equinox|classpass|annual membership|membership fee/i, "subscriptions"],
  [/whole foods|trader joe|safeway|kroger|costco|aldi|grocer|supermarket|wegmans|publix|h-?e-?b|sprouts|instacart|99 ranch|h ?mart|ralphs|vons|albertsons|food lion|stop & shop|meijer|grocery outlet|lucky supermarket|smart & final/i, "groceries"],
  [/pharmacy|\bcvs\b|walgreens|rite aid|medical|clinic|doctor|dental|dentist|hospital|optometr|kaiser|one medical|labcorp|quest diag|urgent care|physical therap|chiropract/i, "health"],
  [/restaurant|caf[eé]|coffee|starbucks|mcdonald|chipotle|doordash|uber\W*eats|grubhub|dining|pizza|sushi|grill|taco|deli|bakery|dunkin|panera|jamba|smoothie|juice|burger king|\bkfc\b|wendy|popeyes|chick-?fil|shake shack|five guys|in-?n-?out|cava|sweetgreen|panda express|noodle|ramen|\bpho\b|eatery|kitchen|brewery|\bbar\b/i, "dining"],
  [/\buber\b|\blyft\b|shell|chevron|exxon|mobil|\barco\b|valero|\bgas\b|fuel|parking|transit|\bmetro\b|\bbart\b|clipper|\btoll|fastrak|e-?z ?pass|amtrak|caltrain|\bdidi\b|\bgrab\b|\bmtr\b|\bmrt\b|subway station|car wash|jiffy lube|auto repair|\bdmv\b/i, "getting_around"],
  [/home depot|lowe'?s|ikea|bed bath|container store|ace hardware|laundr|dry clean|barber|haircut|salon/i, "household"],
  [/movie|cinema|\bamc\b|regal|theater|theatre|concert|ticketmaster|stubhub|seatgeek|eventbrite|\bsteam\b|playstation|xbox|nintendo|bowling|museum|\bzoo\b|golf|arcade|karaoke/i, "fun"],
  [/amazon|target|walmart|best buy|ebay|etsy|nike|apple store|nordstrom|macy|uniqlo|zara|h&m|sephora|ulta|\bstore\b|\bshop\b/i, "shopping"],
];

// Issuer boilerplate that carries no merchant signal. Amex tags every online
// transaction "INTERNET CHARGE", which otherwise reads as an ISP bill and
// drags App Store charges into Utilities.
const DESCRIPTION_NOISE =
  /\binternet charge\b|\baplpay\b|\bapple pay\b|\bsq \*|\btst\* |\bpos debit\b|\brecurring payment\b/gi;

/** Best-guess category slug from a transaction description, or null. */
export function categorizeSlug(description: string): CategorySlug | null {
  const cleaned = description.replace(DESCRIPTION_NOISE, " ");
  for (const [re, slug] of RULES) if (re.test(cleaned)) return slug;
  return null;
}

/**
 * Map an issuer-provided category string onto a slug, when it's specific
 * enough. A bare "Travel" isn't (flight? hotel?), so the description decides.
 */
export function issuerSlug(raw: string | null | undefined): CategorySlug | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (/airline|air travel/.test(s)) return "flights";
  if (/lodging|hotel/.test(s)) return "lodging";
  if (/car rental|rental car/.test(s)) return "car_rental";
  if (/grocery|groceries|supermarket/.test(s)) return "groceries";
  if (/dining|restaurant|food|bar/.test(s)) return "dining";
  if (/gas|fuel|automotive|transportation|transit|parking/.test(s)) return "getting_around";
  if (/health|medical|pharmacy|drug/.test(s)) return "health";
  if (/insurance/.test(s)) return "insurance";
  if (/utilit|phone|cable|internet/.test(s)) return "utilities";
  if (/subscription|streaming/.test(s)) return "subscriptions";
  if (/entertainment|recreation/.test(s)) return "fun";
  if (/home|hardware|household/.test(s)) return "household";
  if (/merchandise|shopping|retail/.test(s)) return "shopping";
  return null;
}

/**
 * Where a label from the old six-category scheme lands when nothing better
 * applies (used once, when moving existing data over). Bills and Other mixed
 * too many things to guess, so they stay unsorted for you to place.
 */
export function legacySlug(old: string | null | undefined): CategorySlug | null {
  switch (old) {
    case "Groceries":
      return "groceries";
    case "Dining":
      return "dining";
    case "Shopping":
      return "shopping";
    case "Transport":
      return "getting_around";
    default:
      return null;
  }
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
export function matchMerchantRule<T extends { match_key: string }>(
  description: string,
  rules: T[]
): T | null {
  const normalized = normalizeDescription(description);
  // Longest key first, so a narrow rule beats a broad one.
  const sorted = [...rules].sort((a, b) => b.match_key.length - a.match_key.length);
  return sorted.find((r) => normalized.startsWith(r.match_key)) ?? null;
}

/** "trader joe" → "Trader Joe": a readable merchant name from a rule key. */
export function merchantName(key: string): string {
  return key
    .replace(/(^|[\s/&-])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase())
    .replace(/\.([a-z])/gi, (_, ch: string) => "." + ch.toLowerCase());
}
