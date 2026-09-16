export function formatCurrency(amount: number, currency: string) {
  const safe = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(safe);
  } catch {
    // Intl throws on a malformed ISO code — fall back rather than blanking the figure.
    return `${currency} ${safe.toFixed(2)}`;
  }
}

/** Always shows a sign, for deltas and running balances. */
export function formatSignedCurrency(amount: number, currency: string) {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `${safe < 0 ? "−" : "+"}${formatCurrency(Math.abs(safe), currency)}`;
}

/**
 * Condenses large figures for hero tiles and chart axes (1.2M, 340.5K) while leaving
 * everyday amounts alone. Uses the currency symbol without forcing 2 decimals.
 */
export function formatCompactCurrency(amount: number, currency: string) {
  const safe = Number.isFinite(amount) ? amount : 0;
  if (Math.abs(safe) < 100_000) return formatCurrency(safe, currency);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(safe);
  } catch {
    return formatCurrency(safe, currency);
  }
}

export function formatPercent(fraction: number) {
  if (!Number.isFinite(fraction)) return "0%";
  return new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 }).format(fraction);
}

/** Percentage that never returns NaN/Infinity and stays within [0, 100]. */
export function safePercent(part: number, total: number) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, (part / total) * 100));
}

export function initials(name: string) {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : "?";
}

/** Title-cases an enum value for display: CREDIT_CARD → Credit card. */
export function humanizeEnum(value: string) {
  const spaced = value.replace(/_/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
