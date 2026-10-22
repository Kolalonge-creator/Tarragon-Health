import { formatNaira } from "@tarragon/commerce";
import type { PlainStatementInput } from "@tarragon/i18n";
import { getProposedConfig } from "@tarragon/shared";

/**
 * The two figures the plain statement quotes, read from versioned configuration and never typed into a page. If either cannot be
 * read the statement degrades to "See the price in the app before you pay" rather than showing a guessed number.
 */
export function readPlainStatementInput(): PlainStatementInput {
  let price: string | null = null;
  let refundDays: number | null = null;
  try {
    const v = getProposedConfig("commerce.membership_prices").value as { individual_kobo?: unknown };
    if (typeof v.individual_kobo === "number" && Number.isFinite(v.individual_kobo)) price = formatNaira(v.individual_kobo);
  } catch {
    price = null;
  }
  try {
    const r = getProposedConfig("membership.refund").value as { window_days?: unknown };
    if (typeof r.window_days === "number" && Number.isFinite(r.window_days)) refundDays = r.window_days;
  } catch {
    refundDays = null;
  }
  return { price, refundDays };
}
