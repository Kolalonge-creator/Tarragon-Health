/**
 * Display formatters for the analytics console. Money is stored in the smallest
 * unit (kobo for NGN, pence/cents for GBP/USD) throughout the platform — these
 * convert to major units for display only.
 */

const CURRENCY_SYMBOL: Record<string, string> = {
  NGN: "₦", // ₦
  GBP: "£", // £
  USD: "$",
};

export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOL[currency] ?? `${currency} `;
}

/** Format a minor-unit amount (e.g. kobo) as a currency string. */
export function formatMinor(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  return `${currencySymbol(currency)}${major.toLocaleString("en-NG", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString("en-NG");
}

export function formatPercent(value: number): string {
  return `${value.toLocaleString("en-NG", { maximumFractionDigits: 1 })}%`;
}

/** A duration in minutes, scaled to whichever unit reads best — minutes under
 * an hour, hours under a day, days beyond that. A raw "6,641.7 min" or
 * "19913.2m" is unreadable; every "avg time to ack/acknowledge" tile should
 * go through this rather than appending "m"/"min" to the raw figure. */
export function formatMinutesDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toLocaleString("en-NG", { maximumFractionDigits: 1 })}h`;
  const days = hours / 24;
  return `${days.toLocaleString("en-NG", { maximumFractionDigits: 1 })}d`;
}
