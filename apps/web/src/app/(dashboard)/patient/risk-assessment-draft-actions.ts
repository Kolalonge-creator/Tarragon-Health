"use server";

import { createClient } from "@/lib/supabase/server";
import { getActingFor } from "@/lib/acting/acting-for";
import { draftAnswersSchema, saveDraftInputSchema, type DraftAnswers } from "@/lib/validation/risk-assessment-review";

/**
 * P14: save and resume for the risk assessment. A draft belongs to the patient only.
 *
 * Every action works on the signed-in person's OWN draft (patient_id = auth.uid(), which is also all the table's RLS
 * accepts) and refuses outright while they are acting for someone: saving then would put that person's half-finished
 * answers on the supporter's own record. The form does not offer saving while acting either; this is the server half.
 */

const ACTING_MESSAGE = "Saving for later is only available on your own account.";

export type DraftLoad =
  | { ok: true; draft: { answers: DraftAnswers; step: number; updatedAt: string } | null }
  | { ok: false; error: string };

export async function loadRiskAssessmentDraft(): Promise<DraftLoad> {
  if (await getActingFor()) return { ok: true, draft: null };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const { data, error } = await supabase
    .from("risk_assessment_drafts")
    .select("answers, step, updated_at")
    .eq("patient_id", user.id)
    .maybeSingle();
  if (error) return { ok: false, error: "Couldn't load your saved answers." };
  if (!data) return { ok: true, draft: null };
  const answers = draftAnswersSchema.safeParse(data.answers);
  // A draft that no longer matches the form is ignored rather than half-applied.
  if (!answers.success) return { ok: true, draft: null };
  return { ok: true, draft: { answers: answers.data, step: data.step, updatedAt: data.updated_at } };
}

export async function saveRiskAssessmentDraft(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = saveDraftInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Some answers could not be saved. Please check them and try again." };
  if (await getActingFor()) return { ok: false, error: ACTING_MESSAGE };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !profile?.organisation_id) return { ok: false, error: "Couldn't save your answers. Please try again." };
  const { error } = await supabase.from("risk_assessment_drafts").upsert(
    {
      patient_id: user.id,
      organisation_id: profile.organisation_id,
      answers: parsed.data.answers,
      step: parsed.data.step,
    },
    { onConflict: "patient_id" },
  );
  if (error) return { ok: false, error: "Couldn't save your answers. Please try again." };
  return { ok: true };
}

export async function discardRiskAssessmentDraft(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (await getActingFor()) return { ok: false, error: ACTING_MESSAGE };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const { error } = await supabase.from("risk_assessment_drafts").delete().eq("patient_id", user.id);
  if (error) return { ok: false, error: "Couldn't clear your saved answers." };
  return { ok: true };
}
