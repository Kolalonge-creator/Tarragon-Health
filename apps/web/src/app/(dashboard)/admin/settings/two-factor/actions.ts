"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { Constants } from "@tarragon/shared";

export type SetTwoFactorState = { error?: string; message?: string } | undefined;

const schema = z.object({
  role: z.enum(Constants.public.Enums.user_role),
  // Empty for a whole-role group.
  doctorTier: z.union([z.literal(""), z.enum(Constants.public.Enums.doctor_tier)]),
  required: z.enum(["true", "false"]),
  note: z.string().trim().min(20, "Write a change note of at least 20 characters saying why.").max(2000),
  confirmUnenrolled: z.enum(["true", "false"]).optional(),
});

/**
 * Thin wrapper over public.set_mfa_group_requirement (migration 20261105110919), which is the authority: admin only, a change
 * note of at least 20 characters, never switches on a group containing the caller unless the caller's own session has passed
 * 2FA, needs `confirmUnenrolled` when any account in the group has no factor yet, versions the row and writes the history.
 * This action only shapes the form and refreshes the page.
 */
export async function setTwoFactorRequirementAction(
  _prev: SetTwoFactorState,
  formData: FormData,
): Promise<SetTwoFactorState> {
  const parsed = schema.safeParse({
    role: formData.get("role"),
    doctorTier: formData.get("doctorTier") ?? "",
    required: formData.get("required"),
    note: formData.get("note") ?? "",
    confirmUnenrolled: formData.get("confirmUnenrolled") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const { role, doctorTier, required, note, confirmUnenrolled } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_mfa_group_requirement", {
    p_role: role,
    p_doctor_tier: doctorTier === "" ? null : doctorTier,
    p_required: required === "true",
    p_change_note: note,
    p_confirm_unenrolled: confirmUnenrolled === "true",
  });
  if (error) {
    return { error: error.message || "That change was not saved. Try again." };
  }

  revalidatePath("/admin/settings/two-factor");
  return {
    message:
      required === "true"
        ? "Two-factor sign-in is now required for this group. It applies from each person's next page load."
        : "Two-factor sign-in is now optional for this group again.",
  };
}

export type ResetFactorsState = { error?: string; message?: string } | undefined;

const resetSchema = z.object({
  profileId: z.uuid("Choose an account."),
  reason: z
    .string()
    .trim()
    .min(20, "Write a reason of at least 20 characters (for example, how you confirmed it is really them).")
    .max(2000),
});

/**
 * Thin wrapper over public.admin_reset_mfa_factors (migration 20261105110919): admin only, never your own account, a reason of at
 * least 20 characters, and the resetting admin's own session must be AAL2 to reset another admin or the CMO. In one transaction it
 * removes every factor the account has, signs it out on every device, tells the owner, and records the reset. Runs on the
 * admin's own session, never the service-role client (which has no auth.uid(), so the admin check could never pass).
 */
export async function resetMfaFactorsAction(_prev: ResetFactorsState, formData: FormData): Promise<ResetFactorsState> {
  const parsed = resetSchema.safeParse({ profileId: formData.get("profileId"), reason: formData.get("reason") ?? "" });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_reset_mfa_factors", {
    p_profile: parsed.data.profileId,
    p_reason: parsed.data.reason,
  });
  if (error) {
    return { error: error.message || "The reset did not go through. Nothing was changed." };
  }

  const sessions =
    data && typeof data === "object" && !Array.isArray(data) && typeof data.sessions_ended === "number" ? data.sessions_ended : 0;
  revalidatePath("/admin/settings/two-factor");
  return {
    message: `Two-factor sign-in was reset and the person was signed out on ${sessions} device${sessions === 1 ? "" : "s"}. They have been told, and set up a new authenticator at their next sign-in.`,
  };
}
