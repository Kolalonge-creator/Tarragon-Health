"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { familyHistoryInputSchema, procedureInputSchema, removeHistoryItemSchema } from "./schemas";

export type HistoryActionResult = { error?: string; success?: boolean };

async function ownContext() {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("organisation_id").eq("id", user.id).maybeSingle();
  if (!profile?.organisation_id) return null;
  return { supabase, userId: user.id, organisationId: profile.organisation_id };
}

/** A person adds a procedure to their own history. Source and verification are fixed by the database. */
export async function addProcedureAction(input: unknown): Promise<HistoryActionResult> {
  const parsed = procedureInputSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check what you entered." };
  const ctx = await ownContext();
  if (!ctx) return { error: "Not signed in" };
  const { error } = await ctx.supabase.from("procedures").insert({
    organisation_id: ctx.organisationId,
    patient_id: ctx.userId,
    name: parsed.data.name,
    approximate_year: parsed.data.year ?? null,
    facility: parsed.data.facility || null,
  });
  if (error) return { error: "That could not be saved. Please try again." };
  revalidatePath("/patient/health-history");
  return { success: true };
}

export async function addFamilyHistoryAction(input: unknown): Promise<HistoryActionResult> {
  const parsed = familyHistoryInputSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check what you entered." };
  const ctx = await ownContext();
  if (!ctx) return { error: "Not signed in" };
  const { error } = await ctx.supabase.from("family_history").insert({
    organisation_id: ctx.organisationId,
    patient_id: ctx.userId,
    condition_name: parsed.data.condition,
    relationship: parsed.data.relationship,
    age_of_onset_years: parsed.data.onsetAge ?? null,
  });
  if (error) return { error: "That could not be saved. Please try again." };
  revalidatePath("/patient/health-history");
  return { success: true };
}

/** Removal is a tombstone, never a silent delete: a clinician-confirmed item stays in the record for audit. */
export async function removeHistoryItemAction(input: unknown): Promise<HistoryActionResult> {
  const parsed = removeHistoryItemSchema.safeParse(input);
  if (!parsed.success) return { error: "That could not be removed." };
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_history_item", { p_kind: parsed.data.kind, p_id: parsed.data.id });
  if (error) return { error: "That could not be removed." };
  revalidatePath("/patient/health-history");
  return { success: true };
}
