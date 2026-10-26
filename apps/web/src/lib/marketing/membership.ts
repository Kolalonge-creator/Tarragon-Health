import { formatNaira } from "@tarragon/commerce";
import { t } from "@tarragon/i18n";
import { getProposedConfig } from "@tarragon/shared";

/**
 * The single place the public marketing site reads the Membership price, the
 * refund window and the "what Membership includes" lines. /pricing, /gift and
 * the homepage all import from here, so they cannot drift apart (the homepage
 * once told visitors "not a subscription" while /pricing sold an annual
 * Membership, because each page carried its own copy of this logic).
 *
 * Nothing here types a number: the price and the window come from versioned
 * config (integer kobo and whole days).
 * src/lib/marketing/no-public-prices.test.ts guards that no other naira
 * figure reaches a marketing file.
 */

/** The individual Membership price in kobo (commerce.membership_prices). */
export function membershipPriceKobo(): number {
  const v = getProposedConfig("commerce.membership_prices").value as { individual_kobo: number };
  return v.individual_kobo;
}

/** The Membership price formatted for display, without the currency symbol (callers add it). */
export function membershipPriceLabel(): string {
  return formatNaira(membershipPriceKobo());
}

/** The refund window in whole days (membership.refund). */
export function refundWindowDays(): number {
  const v = getProposedConfig("membership.refund").value as { window_days: number };
  return v.window_days;
}

/** What a Membership includes, in the words the catalogue itself uses. */
export const MEMBERSHIP_INCLUDES = [
  t("catalog.membership_annual.incl.1", "en"),
  t("catalog.membership_annual.incl.2", "en"),
  t("catalog.membership_annual.incl.3", "en"),
  t("catalog.membership_annual.incl.4", "en"),
] as const;
