"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { generatePatientExplanation } from "./generate";
import type { ExplainerKind } from "./snapshot";

export interface PatientExplanationResult {
  status: "generated" | "failed";
  explanation: string | null;
}

/**
 * Explains the CALLER's OWN latest value for (kind, subjectKey) -- there is
 * deliberately no patientId parameter, so this action can never be pointed
 * at another patient's data; RLS on patient_result_explanations would block
 * a cross-patient read anyway, but the action itself never accepts the
 * possibility. `languageOverride` lets the patient toggle to English even
 * when their profile.language is set to something else -- each language
 * caches as its own row, so toggling never re-spends on a language already
 * generated.
 *
 * Cache-first: a past reading never changes, so a previously generated
 * explanation for this exact (patient, kind, key, language) is reused
 * indefinitely -- no repeat Anthropic call for a patient re-reading the same
 * card.
 */
export async function explainPatientResultAction(
  kind: ExplainerKind,
  subjectKey: string,
  label: string,
  languageOverride?: string
): Promise<PatientExplanationResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "failed", explanation: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id, language")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.organisation_id) return { status: "failed", explanation: null };

  const language = languageOverride ?? profile.language ?? "en";

  const { data: cached } = await supabase
    .from("patient_result_explanations")
    .select("status, explanation_text")
    .eq("patient_id", user.id)
    .eq("kind", kind)
    .eq("subject_key", subjectKey)
    .eq("language", language)
    .maybeSingle();

  if (cached?.status === "generated" && cached.explanation_text) {
    return { status: "generated", explanation: cached.explanation_text };
  }

  const result = await generatePatientExplanation(supabase, createServiceRoleClient, {
    patientId: user.id,
    organisationId: profile.organisation_id,
    kind,
    subjectKey,
    label,
    language,
  });

  return { status: result.status, explanation: result.explanation ?? null };
}
