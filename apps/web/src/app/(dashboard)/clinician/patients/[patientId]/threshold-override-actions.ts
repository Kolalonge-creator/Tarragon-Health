"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { hasPrescribingAuthority } from "@/lib/clinical/doctor-tier";
import { parseProposal } from "@/lib/threshold-overrides/proposal";

export type ThresholdOverrideState = { error?: string; success?: string } | undefined;

type RpcClient = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> };

/** A refusal the database wrote for a person is shown as written; anything else is a generic message (no internals leak). */
function message(error: { message: string; code?: string }): string {
  if (error.code === "42501") return "Only a senior doctor with a care relationship to this patient can do this.";
  if (error.code === "55000" || error.code === "22023") return error.message;
  return "That did not work. Nothing was saved. Please try again.";
}

const uuid = z.string().uuid();

/** A senior doctor proposes a personal threshold. It does nothing until the same or another tied senior doctor signs it. */
export async function proposeThresholdOverride(_prev: ThresholdOverrideState, formData: FormData): Promise<ThresholdOverrideState> {
  if (!hasPrescribingAuthority(await getCurrentClinicalStaff())) return { error: "Only a senior doctor can set a personal threshold." };
  const parsed = parseProposal(formData);
  if (!parsed.ok) return { error: parsed.error };
  const { patientId, domain, params, reason, days } = parsed.value;
  const supabase = (await createClient()) as unknown as RpcClient;
  const { error } = await supabase.rpc("propose_threshold_override", { p_patient: patientId, p_domain: domain, p_params: params, p_reason: reason, p_days: days });
  if (error) return { error: message(error) };
  revalidatePath(`/clinician/patients/${patientId}`);
  return { success: "Proposed. It has no effect until it is signed." };
}

/** The doctor signs by typing SIGN. Nothing is signed on anyone's behalf. */
export async function signThresholdOverride(_prev: ThresholdOverrideState, formData: FormData): Promise<ThresholdOverrideState> {
  if (!hasPrescribingAuthority(await getCurrentClinicalStaff())) return { error: "Only a senior doctor can sign a personal threshold." };
  const id = uuid.safeParse(formData.get("override_id"));
  const patient = uuid.safeParse(formData.get("patient_id"));
  if (!id.success || !patient.success) return { error: "That override could not be found." };
  if (String(formData.get("typed") ?? "").trim().toUpperCase() !== "SIGN" || formData.get("understood") === null) return { error: "Tick the box and type the word SIGN. Nothing was signed." };
  const supabase = (await createClient()) as unknown as RpcClient;
  const { error } = await supabase.rpc("sign_threshold_override", { p_id: id.data, p_confirm: "SIGN" });
  if (error) return { error: message(error) };
  revalidatePath(`/clinician/patients/${patient.data}`);
  return { success: "Signed. It applies from the next reading and returns to the default on its own when it expires." };
}

export async function revokeThresholdOverride(_prev: ThresholdOverrideState, formData: FormData): Promise<ThresholdOverrideState> {
  if (!hasPrescribingAuthority(await getCurrentClinicalStaff())) return { error: "Only a senior doctor can end a personal threshold." };
  const id = uuid.safeParse(formData.get("override_id"));
  const patient = uuid.safeParse(formData.get("patient_id"));
  const reason = z.string().trim().min(5, "Write a reason of at least 5 characters.").safeParse(formData.get("reason") ?? "");
  if (!id.success || !patient.success) return { error: "That override could not be found." };
  if (!reason.success) return { error: reason.error.issues[0]?.message ?? "Write a reason." };
  const supabase = (await createClient()) as unknown as RpcClient;
  const { error } = await supabase.rpc("revoke_threshold_override", { p_id: id.data, p_reason: reason.data });
  if (error) return { error: message(error) };
  revalidatePath(`/clinician/patients/${patient.data}`);
  return { success: "Ended. The default thresholds apply again." };
}
