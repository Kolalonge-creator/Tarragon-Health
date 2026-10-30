import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { t } from "@tarragon/i18n";

/**
 * W-53 (2026-10-27, founder decision D-03): a patient is only ever told "your care team has been notified / a doctor will be in touch" when
 * doctor review is actually true for them. Doctor review is a Membership feature, gated by the same flag the red-screen status uses
 * (`vitals_red_flag_doctor_escalation`, resolved by `public.patient_has_feature_access`, mirrored on mobile in
 * `apps/mobile/src/lib/doctor-review.ts`).
 *
 * Unlike `patientHasVitalsEscalationAccess` (which fails toward PAGING when the lookup fails, because a missed page is the worse mistake),
 * this fails toward making NO claim: a lookup error answers `false`, so the patient sees the plain "saved" line. Promising a doctor who is
 * not coming is the worse mistake here.
 */
const FEATURE = "vitals_red_flag_doctor_escalation";

export async function patientHasDoctorReview(supabase: SupabaseClient<Database>, patientId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("patient_has_feature_access", { p_patient_id: patientId, p_feature: FEATURE });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

/** The reply to a logged reading that raised a flag. Only a Member is told the care team has been notified (C-02); Free still hears that the reading is outside the usual range, with no promise of follow-up (wording pending CMO sign-off). */
export function flaggedReadingMessage(doctorReview: boolean): string {
  return doctorReview
    ? "Thanks for logging this. Your care team has been notified and a doctor will be in touch."
    : t("freered.reading.free_flag", "en");
}
