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
 * A kobo amount as naira for a PATIENT-facing price line (design principle 4: the naira price shows before commitment).
 * Whole naira print without decimals ("₦12,500"); any kobo part prints both decimals ("₦12,500.50") so nothing rounds away. Staff
 * screens that reconcile payments keep using `formatKobo` (always two decimals). Throws on a non-integer or negative amount rather than
 * showing a wrong price.
 */
export function formatNairaForPatient(kobo: number): string {
  if (!Number.isInteger(kobo) || kobo < 0) throw new RangeError(`price must be a non-negative whole number of kobo, got ${kobo}`);
  const whole = kobo % 100 === 0;
  return `₦${koboToNaira(kobo).toLocaleString("en-NG", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
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
