import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export interface HeightStatus {
  /** The height to use for BMI right now. Prefers the dedicated
   * profiles.height_cm column once it exists; falls back to the latest
   * risk_assessment_responses "height_cm" answer when it doesn't. Null when
   * neither source has a value yet. */
  heightCm: number | null;
  /** Present only when profiles.height_cm and the latest questionnaire
   * answer disagree and that answer hasn't been reconciled yet — the vitals
   * page surfaces this as a "which height is right?" prompt. */
  discrepancy: {
    profileHeightCm: number;
    questionnaireHeightCm: number;
    questionnaireAnsweredAt: string;
  } | null;
}

// Rounding differences between a hand-typed profile value and a re-typed
// questionnaire answer (e.g. 170 vs 170.0) shouldn't count as a real conflict.
const AGREEMENT_TOLERANCE_CM = 0.5;

/**
 * Reconciles the two places a patient's height can come from: the dedicated
 * profiles.height_cm column (set via the profile settings form, or by
 * resolving a past discrepancy) and the latest risk_assessment_responses
 * "height_cm" answer (full history is kept there, but only the newest
 * answer is ever compared — see submitRiskAssessment).
 *
 * profiles.height_cm is the source of truth once it exists and is never
 * silently overwritten by a new questionnaire answer. The questionnaire
 * value only matters as (a) a fallback when no profile height is on file
 * yet, or (b) something to flag when it disagrees with the profile value.
 * height_reconciled_at records the last time the patient explicitly picked
 * a value, so a later questionnaire retake with yet another differing
 * answer correctly re-flags rather than being silently swallowed forever.
 */
export async function fetchHeightStatus(
  supabase: SupabaseClient<Database>,
  patientId: string
): Promise<HeightStatus> {
  const [{ data: profile }, { data: latestAnswer }] = await Promise.all([
    supabase
      .from("profiles")
      .select("height_cm, height_reconciled_at")
      .eq("id", patientId)
      .maybeSingle(),
    supabase
      .from("risk_assessment_responses")
      .select("response, created_at")
      .eq("profile_id", patientId)
      .eq("question_key", "height_cm")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const profileHeightCm = profile?.height_cm ?? null;
  const questionnaireHeightCm =
    typeof latestAnswer?.response === "number" ? latestAnswer.response : null;

  if (profileHeightCm == null) {
    return { heightCm: questionnaireHeightCm, discrepancy: null };
  }
  if (questionnaireHeightCm == null) {
    return { heightCm: profileHeightCm, discrepancy: null };
  }
  if (Math.abs(profileHeightCm - questionnaireHeightCm) < AGREEMENT_TOLERANCE_CM) {
    return { heightCm: profileHeightCm, discrepancy: null };
  }

  const reconciledAfterThisAnswer =
    profile?.height_reconciled_at != null &&
    latestAnswer?.created_at != null &&
    new Date(profile.height_reconciled_at).getTime() >= new Date(latestAnswer.created_at).getTime();
  if (reconciledAfterThisAnswer) {
    return { heightCm: profileHeightCm, discrepancy: null };
  }

  return {
    heightCm: profileHeightCm,
    discrepancy: {
      profileHeightCm,
      questionnaireHeightCm,
      questionnaireAnsweredAt: latestAnswer!.created_at,
    },
  };
}
