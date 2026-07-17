"use server";

import { createClient } from "@/lib/supabase/server";
import {
  lifestyleAssessmentSchema,
  lifestyleGoalSchema,
} from "@/lib/validation/lifestyle";

export type LifestyleActionState = { error?: string; success?: boolean } | undefined;

/**
 * All three inserts resolve organisation_id server-side from the authenticated
 * profile — never trusting a client-supplied org — which is exactly what the
 * RLS insert policies require (patient_id = auth.uid() AND organisation_id =
 * current_org_id()). Same shape as logVital in ./actions.ts.
 */
async function currentPatient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" as const };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) return { error: "No organisation on file" as const };

  return { supabase, userId: user.id, organisationId: profile.organisation_id };
}

export async function saveLifestyleAssessment(
  _prev: LifestyleActionState,
  formData: FormData,
): Promise<LifestyleActionState> {
  const raw = Object.fromEntries(formData.entries());
  // Empty strings from optional inputs → undefined so coercion/nullish work.
  const cleaned = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, v === "" ? undefined : v]),
  );
  const parsed = lifestyleAssessmentSchema.safeParse(cleaned);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase.from("lifestyle_assessments").insert({
    organisation_id: ctx.organisationId,
    patient_id: ctx.userId,
    ...parsed.data,
  });
  if (error) return { error: error.message };
  return { success: true };
}

export async function createLifestyleGoal(
  _prev: LifestyleActionState,
  formData: FormData,
): Promise<LifestyleActionState> {
  const raw = Object.fromEntries(formData.entries());
  const cleaned = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, v === "" ? undefined : v]),
  );
  const parsed = lifestyleGoalSchema.safeParse(cleaned);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase.from("lifestyle_goals").insert({
    organisation_id: ctx.organisationId,
    patient_id: ctx.userId,
    ...parsed.data,
  });
  if (error) return { error: error.message };
  return { success: true };
}

export async function enrolLifestyleProgramme(
  _prev: LifestyleActionState,
  formData: FormData,
): Promise<LifestyleActionState> {
  const programmeId = formData.get("programme_id");
  if (typeof programmeId !== "string" || !programmeId) {
    return { error: "Choose a programme" };
  }

  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase.from("lifestyle_programme_enrolments").insert({
    organisation_id: ctx.organisationId,
    patient_id: ctx.userId,
    programme_id: programmeId,
  });
  if (error) {
    // Unique (patient_id, programme_id) → already enrolled.
    if (error.code === "23505") return { error: "You're already enrolled in this programme." };
    return { error: error.message };
  }
  return { success: true };
}
