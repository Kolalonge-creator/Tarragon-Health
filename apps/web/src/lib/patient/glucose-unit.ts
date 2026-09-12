import { cache } from "react";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DEFAULT_GLUCOSE_DISPLAY_UNIT, type GlucoseDisplayUnit } from "@tarragon/shared";

/**
 * The signed-in reader's own glucose display unit, for server components that
 * render a glucose figure without going through getPatientDashboardContext().
 *
 * Same resolution rule as that context (the CALLER's preference, not the
 * subject's — see the comment there), just reachable from a card that only
 * ever received a patientId. cache()d so a page rendering several glucose
 * cards resolves it once.
 *
 * Falls back to the Nigerian default rather than throwing: a missing
 * preference must never be the reason a reading fails to render.
 */
export const getGlucoseDisplayUnit = cache(async (): Promise<GlucoseDisplayUnit> => {
  const profile = await getCurrentProfile();
  return profile?.glucose_display_unit === "mmol_l" ? "mmol_l" : DEFAULT_GLUCOSE_DISPLAY_UNIT;
});
