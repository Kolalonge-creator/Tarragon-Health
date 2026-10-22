"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { rowFromChoices } from "./field-choices";
import { coverageInputSchema } from "./coverage";

export type EmergencyCardActionResult = { error?: string; success?: boolean; message?: string };

/**
 * Create (or rotate) the caller's own LIVE LINK — the opt-in extra on top of
 * the printed card (2026-08-03 redesign).
 *
 * Takes no patient argument by design — `public.create_emergency_card()` acts
 * only on auth.uid(), so there is no parameter through which one person could
 * mint a link for another. Proven in packages/db/tests/emergency_cards.sql.
 *
 * Calling this again ROTATES: the previous token stops working immediately and
 * a fresh 12-month expiry starts. That is the answer to a shared or lost link.
 */
export async function createEmergencyCardAction(): Promise<EmergencyCardActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_emergency_card");
  if (error) return { error: error.message };

  revalidatePath("/patient/emergency-card");
  return {
    success: true,
    message: "Your live link is ready. It lasts 12 months and you'll be reminded before it expires.",
  };
}

const fieldChoicesSchema = z.object({
  date_of_birth: z.boolean(),
  sex: z.boolean(),
  patient_number: z.boolean(),
  allergies: z.boolean(),
  medications: z.boolean(),
  conditions: z.boolean(),
  blood: z.boolean(),
  emergency_contact: z.boolean(),
  reproductive: z.boolean(),
  mental_health: z.boolean(),
  lock_screen_opt_in: z.boolean(),
});

/**
 * The person chooses which details their emergency card shows (S43, spec 2.7).
 * Applies to the printed card at once and to the live link inside the database
 * wrapper (emergency_card_by_token), so a hidden field cannot be read around it.
 * Acts only on the caller's own row: the primary key is the caller, never a
 * client-supplied id.
 */
export async function saveEmergencyCardFieldsAction(input: unknown): Promise<EmergencyCardActionResult> {
  const parsed = fieldChoicesSchema.safeParse(input);
  if (!parsed.success) return { error: "That could not be saved. Please try again." };
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("organisation_id").eq("id", user.id).maybeSingle();
  if (!profile?.organisation_id) return { error: "That could not be saved. Please try again." };
  const row = rowFromChoices(parsed.data);
  const { error } = await supabase
    .from("emergency_card_fields")
    .upsert({ patient_id: user.id, organisation_id: profile.organisation_id, ...row }, { onConflict: "patient_id" });
  if (error) return { error: "That could not be saved. Please try again." };

  revalidatePath("/patient/emergency-card");
  revalidatePath("/patient/emergency-card/print");
  return { success: true, message: "Saved." };
}

/**
 * S09y: the patient's own HMO / NHIA cover for the emergency card. Both fields blank removes it. The database function is the only door (no table
 * write is granted), takes no patient argument, and records the audit row with field names only, never the number.
 */
export async function saveEmergencyCardCoverageAction(input: unknown): Promise<EmergencyCardActionResult & { field?: "member_number" | "plan_name" | "scheme" }> {
  const parsed = coverageInputSchema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { error: "invalid", field: field === "member_number" || field === "plan_name" ? field : "scheme" };
  }
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_emergency_card_coverage", {
    p_scheme: parsed.data.scheme,
    p_member_number: parsed.data.member_number,
    p_plan_name: parsed.data.plan_name,
  });
  if (error) return { error: "That could not be saved. Please try again." };

  revalidatePath("/patient/emergency-card");
  revalidatePath("/patient/emergency-card/print");
  return { success: true, message: parsed.data.member_number === "" && parsed.data.plan_name === "" ? "removed" : "saved" };
}

export async function revokeEmergencyCardAction(): Promise<EmergencyCardActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_emergency_card");
  if (error) return { error: error.message };

  revalidatePath("/patient/emergency-card");
  return {
    success: true,
    message: "Your live link has been withdrawn. Your printed card is unaffected.",
  };
}
