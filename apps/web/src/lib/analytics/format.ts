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
