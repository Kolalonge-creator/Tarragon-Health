/**
 * Naira display for staff money forms.
 *
 * Every NGN amount is stored in kobo (CLAUDE.md), but nobody types kobo. Staff
 * forms take naira and convert once, at the submit boundary, with
 * `parseMoneyInput` in lib/finance/money-input.ts, which reads the typed amount
 * exactly or refuses it with a reason. This file only shows kobo back as naira,
 * so the operator sees the amount they are confirming.
 */

import { koboToNaira } from "@tarragon/shared";

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
