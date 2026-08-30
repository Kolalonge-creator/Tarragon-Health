/**
 * §91.6 price transparency. Distinct from review-price.tsx's deliberate
 * per-test-price suppression for lab bundles (a clinical-privacy decision —
 * see private.price_review_for_patient) — this is a genuinely itemized
 * breakdown for everything else, and where a lab bundle is involved it
 * collapses to that same single suppressed "Lab tests" line rather than
 * reimplementing or undoing that suppression.
 *
 * No new pricing source of truth: every checkout action already computes a
 * server-pinned price (payable_kobo, a plan's price_minor, ...) — this type
 * just gives that number a shape a confirm dialog can render honestly,
 * including discounts already applied server-side. `vat` ships as a stub
 * until the VAT engine (§91.16) exists; every real account is `exempt`
 * today, so `amount_kobo` is always 0 in practice right now.
 */
export interface PriceBreakdownLine {
  label: string;
  amountKobo: number;
}

export interface PriceBreakdown {
  currency: string;
  lines: PriceBreakdownLine[];
  discounts: PriceBreakdownLine[];
  vat: { treatment: "exempt" | "standard" | "zero_rated"; amountKobo: number };
  totalKobo: number;
}

/** A single flat line at the total price, no discounts — the common case for
 * a flow with nothing yet to itemize further (a subscription plan, a video
 * visit). Kept as one small helper rather than repeating this object shape
 * at every call site. */
export function flatBreakdown(label: string, amountKobo: number, currency = "NGN"): PriceBreakdown {
  return {
    currency,
    lines: [{ label, amountKobo }],
    discounts: [],
    vat: { treatment: "exempt", amountKobo: 0 },
    totalKobo: amountKobo,
  };
}

/** A priced order (lab/pharmacy/referral) that may already carry a voucher
 * and/or subscriber discount applied server-side — `totalKobo` is the
 * catalogue price, `payableKobo` is what's actually owed (a generated DB
 * column, already net of both). Rather than requiring every call site to
 * separately know which discount mechanism applied (not always available at
 * the point a pay button renders), the gap between the two collapses into
 * one honest "Discount applied" line — it doesn't claim false precision
 * about which mechanism produced it. */
export function orderBreakdown(args: {
  label: string;
  totalKobo: number;
  payableKobo: number;
  currency?: string;
}): PriceBreakdown {
  const discountKobo = args.totalKobo - args.payableKobo;
  const discounts: PriceBreakdownLine[] =
    discountKobo > 0 ? [{ label: "Discount applied", amountKobo: -discountKobo }] : [];
  return {
    currency: args.currency ?? "NGN",
    lines: [{ label: args.label, amountKobo: args.totalKobo }],
    discounts,
    vat: { treatment: "exempt", amountKobo: 0 },
    totalKobo: args.payableKobo,
  };
}
