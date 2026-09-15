/**
 * Naira/kobo display and input parsing for staff money forms.
 *
 * Every NGN amount is stored in kobo (CLAUDE.md), but nobody types kobo. A
 * screen that reads amounts in naira and collects them in kobo is a 100x
 * error waiting to happen with no backstop, so staff forms take naira and
 * convert once, here, at the submit boundary.
 */

import { koboToNaira, nairaToKobo } from "@tarragon/shared";

/** A kobo amount as naira, always with two decimals, e.g. "₦50,000.00".
 * Fixed decimals on purpose: this is the string an operator checks a payment
 * against, and a trailing 50 kobo must not round away silently. */
export function formatKobo(kobo: number): string {
  return `₦${koboToNaira(kobo).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Parse what an operator typed into a naira money field, returning kobo.
 *
 * Returns null when the field is blank or is not a finite number, so a caller
 * can refuse to submit rather than posting a zero. Commas and a leading ₦ are
 * tolerated because operators paste amounts from invoices.
 */
export function nairaInputToKobo(value: FormDataEntryValue | string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[₦,\s]/g, "");
  if (cleaned === "") return null;
  const naira = Number(cleaned);
  if (!Number.isFinite(naira) || naira < 0) return null;
  return nairaToKobo(naira);
}
