/**
 * The finance console's money definitions, in one place. The glossary page shows
 * these, and every KPI on the overview links its tooltip to the same entry, so a
 * figure and its explanation can never drift apart.
 *
 * The SQL that computes each figure is `private.finance_money_events` and
 * `private.finance_money_totals` (migration 20261107015736). If a definition here
 * changes, that SQL must change in the same PR, and the reverse.
 */

export type FinanceTermKey =
  | "gross_payment_volume"
  | "refunds"
  | "net_collections"
  | "recognised_revenue"
  | "active_paid_memberships"
  | "successful_payments"
  | "failed_payments"
  | "payment_success_rate"
  | "open_reconciliation_items"
  | "family_sponsor"
  | "customer_fees"
  | "processing_error";

export interface FinanceTerm {
  key: FinanceTermKey;
  term: string;
  /** One or two plain sentences: what the figure is. */
  definition: string;
  /** What is counted and what is not. */
  basis: string;
}

export const FINANCE_TERMS: readonly FinanceTerm[] = [
  {
    key: "gross_payment_volume",
    term: "Gross payment volume",
    definition: "Everything payers were charged and the payment provider confirmed in the period, before refunds.",
    basis:
      "Paid Membership and other checkout orders (including the card fee the payer paid), confirmed Paystack charges, and employer invoices marked paid. Counted on the day the payment was confirmed (Lagos time). A payment later refunded still counts here; its refund is counted under Refunds. Failed and abandoned payments, promo codes, vouchers redeemed and test accounts are not counted.",
  },
  {
    key: "refunds",
    term: "Refunds",
    definition: "Money returned to payers that the payment provider confirmed in the period.",
    basis:
      "Completed refunds only, counted on the day they completed. A refund that has been requested or approved but not yet confirmed is not counted.",
  },
  {
    key: "net_collections",
    term: "Net collections",
    definition: "Gross payment volume less refunds in the same period.",
    basis:
      "Cash basis. It is not revenue: an annual Membership paid today is collected today but earned across the year. Provider fees deducted at settlement are not subtracted here; settlement reconciliation shows them.",
  },
  {
    key: "recognised_revenue",
    term: "Recognised revenue",
    definition: "Revenue earned in the period according to the general ledger.",
    basis:
      "Revenue account credits less debits, less contra-revenue (discounts), by journal entry date. Payments for services not yet delivered sit in deferred revenue and are recognised as they are delivered, so this can differ a lot from net collections.",
  },
  {
    key: "active_paid_memberships",
    term: "Active paid Memberships",
    definition: "Memberships in force on the last day of the period that someone paid for.",
    basis:
      "Bought by the member, by a family sponsor or Care Voucher, or by an employer. Memberships granted free by staff, Free accounts and test accounts are not counted.",
  },
  {
    key: "successful_payments",
    term: "Successful payments",
    definition: "The number of payments counted in gross payment volume.",
    basis: "One per confirmed payment, whatever its size.",
  },
  {
    key: "failed_payments",
    term: "Failed payments",
    definition: "Checkout attempts the payment provider declined or that ended in failure.",
    basis:
      "A failed payment moved no money. It is never revenue and never an amount owed. Abandoned checkouts (the payer closed the page) are not counted as failures.",
  },
  {
    key: "payment_success_rate",
    term: "Payment success rate",
    definition: "Successful payments divided by successful plus failed payments.",
    basis:
      "Only attempts that reached an outcome. Shown as not available, never as 0%, when there were no attempts.",
  },
  {
    key: "open_reconciliation_items",
    term: "Open reconciliation items",
    definition: "Payments, settlements or refunds the reconciliation sweep could not match and nobody has resolved yet.",
    basis:
      "Open flags from the reconciliation sweep, whatever their date. A flag disappears only when someone resolves or ignores it with a note, never when a notification is read.",
  },
  {
    key: "family_sponsor",
    term: "Family sponsor",
    definition: "Someone who paid for another person's Membership or care, including a relative abroad.",
    basis:
      "Recognised when the payer is not the person receiving the care (a gifted order or a Care Voucher bought for someone else). Paying for someone gives no access to their health record.",
  },
  {
    key: "customer_fees",
    term: "Card fees paid by payers",
    definition: "The card processing fee added at checkout and paid by the payer.",
    basis: "Included in gross payment volume. Fees Paystack deducts from settlements are separate.",
  },
  {
    key: "processing_error",
    term: "Payment with a processing error",
    definition: "A payment the provider confirmed but that our system failed to apply.",
    basis:
      "The money was taken, so it counts in gross payment volume. It needs someone to check that the payer received what they paid for.",
  },
];

export function financeTerm(key: FinanceTermKey): FinanceTerm {
  const found = FINANCE_TERMS.find((t) => t.key === key);
  if (!found) throw new Error(`Unknown finance term: ${key}`);
  return found;
}

/** Labels for the payer types the money-events view emits. */
export const PAYER_TYPE_LABEL: Record<string, string> = {
  individual: "Paid by the member",
  family_sponsor: "Family sponsors",
  employer: "Employers",
};

/** Labels for the revenue streams the money-events view emits. Unknown streams fall back to a readable form of the code. */
export const STREAM_LABEL: Record<string, string> = {
  membership: "Membership",
  employer_membership: "Employer Membership",
  doctor_services: "Doctor services",
  screening_day: "Screening days",
  care_voucher: "Care Vouchers",
  lab: "Laboratory",
  pharmacy: "Pharmacy",
  referral: "Specialist referrals",
  home_visit: "Home visits",
  delivery: "Delivery",
  legacy_subscription: "Retired subscriptions",
  consultation: "Consultations",
  other: "Other",
};

export function streamLabel(stream: string): string {
  return STREAM_LABEL[stream] ?? stream.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export const PROVIDER_LABEL: Record<string, string> = {
  paystack: "Paystack",
  stripe: "Stripe (retired)",
  invoice: "Employer invoice",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider;
}
