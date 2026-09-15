"use client";

/**
 * What a review costs, for this person: nobody but the laboratory they
 * choose. Every `panel_bundles`/`screen_types` row is `guidance_only` as of
 * migration `20260910011846_catalogue_becomes_guidance_not_commerce.sql` —
 * Tarragon does not bill for or book any test, full stop, enforced at the
 * database level (`private.enforce_guidance_only_is_never_billed`) — so
 * this component no longer branches on region/partner-billing state the way
 * it used to (that used `region_service_available(state, 'lab')`, which is
 * now the wrong question to ask; see `useReviewPrice`/`reviewPriceDisplay`
 * in `@/lib/queries/review-price` and `@/lib/labs/review-price-display` for
 * the retired per-patient pricing path, still there but unused since this
 * simplification landed 2026-09-11).
 *
 * `patientId`/`bundleCode`/`patientState` are accepted but unused — kept so
 * every call site doesn't need editing if per-patient pricing ever comes
 * back for a specific, real contracted partner.
 */
export function ReviewPrice({
  className,
}: {
  patientId?: string | null;
  bundleCode?: string | null;
  patientState?: string | null;
  className?: string;
}) {
  return (
    <p className={className}>
      You take this to whichever laboratory you like and pay them directly, at whatever they
      charge. We take nothing on top, and a doctor reads every result.
    </p>
  );
}
