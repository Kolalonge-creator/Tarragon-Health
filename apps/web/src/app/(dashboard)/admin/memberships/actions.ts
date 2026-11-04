"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  describeMembershipError,
  endMembershipSchema,
  endOfDayLagos,
  grantMembershipSchema,
} from "@/lib/memberships/members";

export type MembershipActionState = { error?: string; message?: string } | undefined;

/** Grants a membership by hand. The database checks the caller (admin or CMO), the reason and the dates again. */
export async function grantMembership(
  _prev: MembershipActionState,
  formData: FormData,
): Promise<MembershipActionState> {
  const parsed = grantMembershipSchema.safeParse({
    base: String(formData.get("base") ?? ""),
    patientId: String(formData.get("patient_id") ?? ""),
    endsOn: String(formData.get("ends_on") ?? "").trim() || undefined,
    reason: String(formData.get("reason") ?? ""),
    tier: String(formData.get("tier") ?? "") || undefined,
    collectionState: String(formData.get("collection_state") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };

  const supabase = await createClient();
  // The tier-aware function, always with the Membership tier (T2-01): no collection state is ever sent.
  const args = {
    p_patient: parsed.data.patientId,
    p_reason: parsed.data.reason,
    // Omitted when there is no end date: the argument is optional in the database.
    ...(parsed.data.endsOn ? { p_ends_at: endOfDayLagos(parsed.data.endsOn) } : {}),
  };
  const { error } = await supabase.rpc("grant_membership_tier", {
    ...args,
    p_tier: parsed.data.tier,
  });
  if (error) return { error: describeMembershipError(error) };
  revalidatePath(parsed.data.base);
  return { message: "Membership granted." };
}

/** Ends the active membership. The reason is kept on the record. */
export async function endMembership(
  _prev: MembershipActionState,
  formData: FormData,
): Promise<MembershipActionState> {
  const parsed = endMembershipSchema.safeParse({
    base: String(formData.get("base") ?? ""),
    patientId: String(formData.get("patient_id") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("end_membership", {
    p_patient: parsed.data.patientId,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: describeMembershipError(error) };
  revalidatePath(parsed.data.base);
  return { message: "Membership ended." };
}
