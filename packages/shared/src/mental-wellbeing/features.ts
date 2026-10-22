/**
 * Which of the S56b wellbeing features are open for the signed-in patient (public.wellbeing_features_open). Every flag fails CLOSED: a missing
 * answer, a malformed one or an error means the feature is simply not shown. The calm tool's way out to the crisis card is not one of these and is
 * never behind a flag. Shared by the web page and the phone.
 */
export interface WellbeingFeatures {
  readonly panic: boolean;
  readonly insights: boolean;
  readonly share: boolean;
  readonly insightsHidden: boolean;
}

export const NO_WELLBEING_FEATURES: WellbeingFeatures = { panic: false, insights: false, share: false, insightsHidden: false };

/** Pure: only an exact `true` opens a feature. */
export function parseWellbeingFeatures(raw: unknown): WellbeingFeatures {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return NO_WELLBEING_FEATURES;
  const o = raw as Record<string, unknown>;
  return { panic: o.panic === true, insights: o.insights === true, share: o.share === true, insightsHidden: o.insights_hidden === true };
}
