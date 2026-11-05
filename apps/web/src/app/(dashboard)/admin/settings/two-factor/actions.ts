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
