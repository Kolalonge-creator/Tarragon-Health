/**
 * Which add-ons a subscriber should actually be offered.
 *
 * The rule that matters: never offer an add-on whose features the patient
 * already has. A Complete Care plan carries lifestyle_coaching, ai_coach and
 * prevention_coordination outright, so offering that subscriber the Lifestyle
 * Coaching add-on (₦25,000/month) and the Prevention Screening add-on
 * (₦25,000/year) charges them ₦325,000 a year to unlock nothing — and it
 * looks like it worked, because has_feature_access was already true. Selling
 * somebody something they own is the mis-selling problem that retired the
 * Dedicated Care Coordinator add-on.
 */

/** The fields of an add-on this decision needs — structural, so both the
 * generated `Tables<"add_ons">` row and a test fixture satisfy it. */
export interface AddOnOffer {
  code: string;
  currency: string;
  features: string[] | null;
  restricted_to_plan_code: string | null;
}

export interface AttachableAddOnsInput<T extends AddOnOffer> {
  /** The full add-on catalogue. */
  catalogue: readonly T[];
  /** Features the current plan grants. */
  planFeatures: readonly string[] | null | undefined;
  /** Add-ons already attached: their codes, and the features they grant. */
  attached: readonly { code: string | null | undefined; features: string[] | null | undefined }[];
  /** Currency tab currently being viewed. */
  currency: string;
  /** Plan code, for add-ons restricted to a single plan. */
  currentPlanCode: string | null;
}

export function selectAttachableAddOns<T extends AddOnOffer>({
  catalogue,
  planFeatures,
  attached,
  currency,
  currentPlanCode,
}: AttachableAddOnsInput<T>): T[] {
  const attachedCodes = new Set(
    attached.map((a) => a.code).filter((code): code is string => !!code),
  );
  const grantedFeatures = new Set<string>([
    ...(planFeatures ?? []),
    ...attached.flatMap((a) => a.features ?? []),
  ]);

  return catalogue.filter((addOn) => {
    if (attachedCodes.has(addOn.code)) return false;
    if (addOn.currency !== currency) return false;
    if (
      addOn.restricted_to_plan_code !== null &&
      addOn.restricted_to_plan_code !== currentPlanCode
    ) {
      return false;
    }
    // An add-on granting no features is a data problem, not a free upgrade —
    // hide it rather than charge for an unknown.
    const features = addOn.features ?? [];
    if (features.length === 0) return false;
    return features.some((feature) => !grantedFeatures.has(feature));
  });
}
