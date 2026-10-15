export function fmtUSD(value: number, fractionDigits = 2): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function fmtPct(value: number, digits = 2): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Chart palette — dark-mode categorical slots validated against the site's
// dark surface (dataviz reference palette).
export const SERIES = {
  brokerage: "#3987e5",
  bank: "#199e70",
  cds: "#c98500",
  retirement: "#9085e9",
} as const;

export const DELTA_UP = "#0ca30c";
export const DELTA_DOWN = "#e66767";
