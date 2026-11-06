import { formatNaira } from "@tarragon/commerce";
import { t } from "@tarragon/i18n";
import { getProposedConfig } from "@tarragon/shared";
import { marketingAnonClient } from "./anon-client";

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

/** The employer seat price in kobo (commerce.membership_prices): the same Membership, bought by an employer for each employee. */
export function employerSeatPriceKobo(): number {
  const v = getProposedConfig("commerce.membership_prices").value as { organisation_member_kobo: number };
  return v.organisation_member_kobo;
}

/** The employer seat price formatted for display, without the currency symbol (callers add it). */
export function employerSeatPriceLabel(): string {
  return formatNaira(employerSeatPriceKobo());
}

/**
 * The name of the one paid plan (decisions T2-01 and T2-09, 2026-11-04): "Membership". Membership Plus is retired and is no longer
 * sold, so the public site never names it. The name comes from the catalogue, never a typed word.
 */
export function paidProductName(): string {
  return t("catalog.membership_annual_no_panel.name", "en");
}

/**
 * What a Membership includes, stated plainly and honestly (T2-01, 2026-11-04). Laboratory tests are NOT included: the member uses any
 * reputable laboratory and pays it directly. No doctor review turnaround is promised. Every public page that lists the inclusions reads
 * this one list, so the pages cannot disagree.
 */
export const MEMBERSHIP_INCLUDES = [
  "A personalised preventive plan and test schedule, based on your age, history and conditions",
  "Laboratory request forms you can download and take to any reputable laboratory",
  "Upload your laboratory report: a doctor reviews it, and it goes into your health record",
  "Your health record and trends over time, all in one place",
  "One online meeting with a doctor from your care team each month, and you can buy an extra meeting if you need one",
  "Written questions to your care team between calls",
  "Prescriptions your care team signs, for you to take to any pharmacy",
  "Reminders when a test, a check or a reading is due",
  "Care Circle: someone you trust can follow your care, with your consent",
] as const;

/** Laboratory tests are paid to the laboratory, never through Tarragon, and no laboratory price is ever quoted on the public site. */
export const LAB_TESTS_NOT_INCLUDED =
  "Laboratory tests are not included in the Membership. You choose any reputable laboratory and pay the laboratory directly. Contact the laboratory for current pricing.";

/** The employer line, with the seat price passed in (employerSeatPriceLabel(), from commerce.membership_prices). */
export function employerSeatLine(seatPrice: string): string {
  return `Employers can buy the same Membership for each employee at ₦${seatPrice} per person per year. An employer only ever sees counts, never anyone's results. Visits to a workplace are a separate service, costed on their own, and are not part of a seat.`;
}

/**
 * Does Membership renew automatically? The answer is the platform switch `membership_auto_renew` (public.membership_auto_renew_enabled),
 * read the same way the testimonials are: anon, ISR, fail soft. EVERY public sentence about renewal comes from `renewalCopy` below, which
 * takes this answer, so the site can never say "renews automatically" while the product does not, or the reverse. A failed or missing
 * read means OFF: the conservative, no-charge wording. (If the switch is later turned on, pages pick it up within their revalidate window.)
 */
export async function membershipAutoRenews(): Promise<boolean> {
  try {
    const supabase = marketingAnonClient();
    if (!supabase) return false;
    const rpc = (supabase as unknown as { rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }> }).rpc;
    const { data, error } = await rpc.call(supabase, "membership_auto_renew_enabled");
    return !error && data === true;
  } catch {
    return false;
  }
}

/** Every renewal sentence on the public site, in both states. Never types a price. */
export function renewalCopy(autoRenews: boolean, refundDays: number) {
  return autoRenews
    ? {
        /** One line under the price on a plan card. */
        short: `Lasts a year. If you choose automatic renewal when you pay by card, it renews on that card unless you cancel, in one tap, and you keep the year you paid for. Refundable within ${refundDays} days.`,
        faqAnswer: `Only if you choose it. When you pay by card you can tick a box to renew automatically each year. We charge that card up to 3 days before your year ends, message you before and after, and you can cancel in one tap on the Membership page and keep the year you have paid for. If you pay by bank transfer or USSD, or you do not tick the box, it does not renew by itself and we remind you before it ends. You can ask for a refund within ${refundDays} days of buying it.`,
        pricingBox: "It lasts a year. If you chose automatic renewal when you paid by card, it renews on that card up to 3 days before the year ends unless you cancel. Cancelling is one tap, and you keep the year you have paid for. Otherwise it does not renew by itself. We remind you before it ends, and you keep your Member access for 14 days after.",
        promise: "Membership renews by itself only if you ask it to. If you tick the box when you pay by card, we charge that card up to 3 days before your year ends, tell you before and after, and you can cancel in one tap and keep the year you have paid for. Otherwise nothing renews.",
        trialTerm: "Nothing renews unless you chose it when you paid. Automatic renewal is a box you tick, and you can cancel it in one tap.",
        monitoringAnswer: "Only if you choose it when you pay by card. You can cancel in one tap and keep the year you have paid for. Otherwise it lasts a year, we remind you 30, 14 and 7 days before it ends, and you keep your Member access for 14 days after.",
      }
    : {
        short: `Lasts a year and does not renew by itself; we remind you before it ends. Refundable within ${refundDays} days.`,
        faqAnswer: `No. It lasts a year and we remind you 30, 14 and 7 days before it ends. For 14 days after it ends you keep your Member access, and your records stay with you whatever you choose. You can ask for a refund within ${refundDays} days of buying it.`,
        pricingBox: "It lasts a year and does not renew by itself. We remind you before it ends, and you keep your Member access for 14 days after.",
        promise: "Nothing auto-renews. Membership lasts a year and then simply ends, and we remind you before it does. There is no card kept on file and no cancellation to remember.",
        trialTerm: "Nothing renews automatically. When your Membership ends you join again only if you want to.",
        monitoringAnswer: "No. It lasts a year. We remind you 30, 14 and 7 days before it ends, and you keep your Member access for 14 days after. There is no card kept on file and nothing to cancel.",
      };
}

/**
 * The Membership price with a founding member percent taken off, for the founding member strip. The list price is the same
 * commerce.membership_prices figure as above; the percent comes from the live founding code (lib/marketing/founding-offer.ts), never
 * typed. The pricing engine rounds a discount DOWN (private.price_quote_calc), so the price is the list less the rounded-down share.
 */
export function foundingPriceLabel(percent: number): string {
  const kobo = membershipPriceKobo();
  return formatNaira(kobo - Math.floor((kobo * percent) / 100));
}

export { FREE_PLAN } from "./free-plan";
