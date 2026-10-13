"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { claimDependentAccountSchema } from "@/lib/validation/elder-proxy-dependent";

/**
 * Starts the hand-over of a dependant's record to the person it is about (S04b-1, founder decision R3: at 18 a young
 * person registers their own account and agrees before anything is handed over; nothing transfers silently).
 *
 * Two kinds reach this, with different eligibility gates but the same agreement-gated mechanism:
 *
 * - minor_child, once private.sweep_dependent_majority_review (20260829082711) has flagged majority_review_at, which
 *   only happens once they are 18 or older.
 * - elder_proxy (added 2026-09-13 for the sponsor "buy care for someone not yet a patient" flow), any time the person is
 *   ready to take their record over.
 *
 * What this action does, and what it deliberately does NOT do any more:
 *
 *   1. It records a pending hand-over (public.start_dependant_handover, run as the guardian, so the database checks the
 *      guardian's grant and that the person is 18 or over).
 *   2. It attaches the person's phone number to their existing auth user, UNCONFIRMED, so they can sign in by entering
 *      the code Auth texts them on their own phone. That code is the only SMS involved (INV-08): the old flow also
 *      queued a "your record is now yours" SMS, which was not a verification code (OQ-48) and is gone.
 *   3. It does NOT flip is_dependent_account and does NOT change who can see the record. That only happens in
 *      public.accept_dependant_handover, which only the person themselves can call, signed in on the verified number.
 *      Until then the record stays with the guardian.
 *
 * Nothing is sent to the person from here. The guardian is told, on screen, to ask them to sign in at
 * app.tarragonhealth.ng with that number; the person then sees a card asking them to agree or decline.
 */
export async function claimDependentAccountAction(
  input: unknown
): Promise<{ message: string } | { error: string }> {
  const parsed = claimDependentAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }
  const { dependent_id, phone } = parsed.data;

  const parent = await getCurrentProfile();
  if (!parent) return { error: "Not signed in" };

  const supabase = await createClient();

  const { data: grant } = await supabase
    .from("profile_access")
    .select("id")
    .eq("profile_id", dependent_id)
    .eq("grantee_user_id", parent.id)
    .in("permission_level", ["manage", "view"])
    .maybeSingle();
  if (!grant) return { error: "You don't have access to this record" };

  const { data: dependent } = await supabase
    .from("profiles")
    .select("full_name, is_dependent_account, dependent_kind, majority_review_at")
    .eq("id", dependent_id)
    .single();
  if (
    !dependent?.is_dependent_account ||
    (dependent.dependent_kind !== "minor_child" && dependent.dependent_kind !== "elder_proxy")
  ) {
    return { error: "This isn't a claimable dependent record" };
  }
  // Only minor_child has an age threshold to wait for; the database re-checks the age itself.
  if (dependent.dependent_kind === "minor_child" && !dependent.majority_review_at) {
    return { error: "This record hasn't been flagged for majority review yet" };
  }

  const { data: existing } = await supabase
    .rpc("find_profile_by_phone", { lookup_phone: phone })
    .maybeSingle();
  if (existing) {
    return { error: "That phone number is already on a different Tarragon account" };
  }

  const { error: startError } = await supabase.rpc("start_dependant_handover", {
    p_dependent: dependent_id,
    p_phone: phone,
  });
  if (startError) {
    return { error: "This record can't be handed over yet. They need to be 18 or over." };
  }

  const svc = createServiceRoleClient();
  const { error: authError } = await svc.auth.admin.updateUserById(dependent_id, {
    phone,
    phone_confirm: false,
  });
  if (authError) {
    // Do not leave a pending hand-over for a number that could not be attached.
    await supabase.rpc("cancel_dependant_handover", { p_dependent: dependent_id });
    return { error: authError.message };
  }

  await svc.from("audit_log").insert({
    organisation_id: parent.organisation_id,
    actor_id: parent.id,
    action: "profile.dependent_handover_started",
    entity_type: "profiles",
    entity_id: dependent_id,
  });

  revalidatePath("/patient/family");
  revalidatePath("/patient");
  return {
    message: `${dependent.full_name ?? "They"} can now sign in with that number at app.tarragonhealth.ng. We will ask them to agree before anything changes. Until they do, their record stays with you.`,
  };
}
