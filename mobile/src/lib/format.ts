export function formatCurrency(amount: number, currency: string) {
  const safe = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(safe);
  } catch {
    return `${currency} ${safe.toFixed(2)}`;
  }
}

export function formatSignedCurrency(amount: number, currency: string) {
  const safe = Number.isFinite(amount) ? amount : 0;
  const sign = safe < 0 ? "−" : "+";
  return `${sign}${formatCurrency(Math.abs(safe), currency)}`;
}

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

export function currencySymbol(currency: string) {
  try {
    const parts = new Intl.NumberFormat(undefined, { style: "currency", currency }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

/** Safe percentage: never returns NaN/Infinity, clamps to [0, 100]. */
export function safePercent(part: number, total: number) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  const pct = (part / total) * 100;
  return Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
}

export function initials(name: string) {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed[0].toUpperCase() : "?";
}

export function humanizeEnum(value: string) {
  const spaced = value.replace(/_/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
