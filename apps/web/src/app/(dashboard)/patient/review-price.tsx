"use client";

import { koboToNaira } from "@tarragon/shared";
import { useReviewPrice } from "@/lib/queries/review-price";
import { useRegionServiceAvailable } from "@/lib/queries/service-regions";
import { reviewPriceDisplay } from "@/lib/labs/review-price-display";

/**
 * What this review costs, for this person — one number and nothing else.
 *
 * Two things this component deliberately will not do.
 *
 * It never shows a per-test price. It could not even if it wanted to: for a
 * patient's own session `public.price_review_for_patient` strips them out of
 * its response, so the promise is kept by the database rather than by every
 * screen remembering to keep it.
 *
 * And it never shows a price for a review Tarragon is not billing. Today that
 * is every review: the patient takes the request to a laboratory of their own
 * choosing and pays them directly, so quoting a Tarragon price would be a
 * claim about money that does not change hands. The switch is not a flag in
 * this file — it is `region_service_available(state, 'lab')`, the same gate
 * the database itself uses to decide whether a partner-fulfilled order is
 * even insertable. When a real laboratory is contracted and switched on for
 * a patient's state, this card starts showing their number; until then it
 * shows the truth about who they pay.
 *
 * `priceable` is respected as a hard gate rather than a hint. It is false
 * when a review contains nothing for this patient, or contains a test with no
 * price on file — in both cases there is no honest number to display, so
 * nothing is displayed.
 */
export function ReviewPrice({
  patientId,
  bundleCode,
  patientState,
  className,
}: {
  patientId: string | null | undefined;
  bundleCode: string | null | undefined;
  patientState: string | null | undefined;
  className?: string;
}) {
  const { data: partnerBilling } = useRegionServiceAvailable(patientState, "lab");
  const { data: price, isLoading } = useReviewPrice(
    partnerBilling ? patientId : null,
    partnerBilling ? bundleCode : null,
  );

  const display = reviewPriceDisplay({
    partnerBillingAvailable: partnerBilling,
    isLoading,
    price,
  });

  if (display.kind === "pay_the_lab") {
    return (
      <p className={className}>
        You take this to whichever laboratory you like and pay them directly, at whatever they
        charge. We take nothing on top, and a doctor reads every result.
      </p>
    );
  }

  if (display.kind === "loading") {
    return <p className={className}>Working out your price…</p>;
  }

  if (display.kind === "confirm_later") {
    return (
      <p className={className}>We&apos;ll confirm the price with you before anything is booked.</p>
    );
  }

  return (
    <div className={className}>
      <p className="text-2xl font-semibold tabular-nums text-charcoal-ink dark:text-night-ink">
        ₦{koboToNaira(display.totalKobo).toLocaleString("en-NG")}
      </p>
      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        {display.testCount === 1
          ? "One test, priced for you. You'll see this number and confirm before anything is charged."
          : `All ${display.testCount} checks in this review, priced for you rather than as a standard package. You'll see this number and confirm before anything is charged.`}
      </p>
    </div>
  );
}
