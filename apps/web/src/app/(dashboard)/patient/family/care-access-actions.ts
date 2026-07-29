"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { nominateNextOfKinSchema } from "@/lib/validation/care-access";

/**
 * Names a next of kin: the person Tarragon contacts if something goes wrong,
 * and — when they hold a Tarragon account of their own — the person who may
 * watch this record without being able to change it.
 *
 * The two halves are deliberately independent, because they fail differently:
 *
 *   contactability  always recorded, on the caller's own profiles row, which
 *                   is where private.handle_emergency_event and
 *                   private.notify_unacknowledged_emergencies already read the
 *                   emergency contact from. Works for a next of kin who has
 *                   never heard of Tarragon.
 *   visibility      only when the phone number matches a real account, as a
 *                   profile_access grant at level 'view'.
 *
 * 'view' is the whole point and is enforced by the database, not by this
 * function: every RLS policy that admits a profile_access grantee to a write
 * (vaccination_records, reproductive_health_profiles, booking_requests)
 * requires level 'manage'. A next of kin sees the record and cannot edit it.
 * 'manage' is reserved for a child dependant who has no login of their own —
 * see addChildDependentAction.
 *
 * Runs on the caller's own RLS-scoped client, never service role: the
 * profile_access INSERT policy requires profile_id = auth.uid() AND
 * granted_by = auth.uid(), so the database itself guarantees a person can only
 * ever give away access to their own record, never take it over someone
 * else's. That check is not duplicated here because it must not be
 * duplicated — one place to be wrong is better than two.
 */
export async function nominateNextOfKinAction(
  input: unknown
): Promise<{ message: string } | { error: string }> {
  const parsed = nominateNextOfKinSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }
  const { full_name, phone, relationship } = parsed.data;

  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in" };

  const supabase = await createClient();

  const { error: contactError } = await supabase
    .from("profiles")
    .update({
      emergency_contact_name: full_name,
      emergency_contact_phone: phone,
      emergency_contact_relationship: relationship,
      emergency_contact_consent: true,
      emergency_contact_consent_at: new Date().toISOString(),
    })
    .eq("id", profile.id);
  if (contactError) return { error: contactError.message };

  const { data: found } = await supabase
    .rpc("find_profile_by_phone", { lookup_phone: phone })
    .maybeSingle();

  if (!found || found.id === profile.id) {
    return {
      message: `${full_name} is now your next of kin. We'll contact them if something urgent comes up. They don't have a Tarragon account on that number yet, so there's nothing for them to view — add them again once they sign up and they'll be able to follow your care.`,
    };
  }

  const { error: accessError } = await supabase.from("profile_access").insert({
    profile_id: profile.id,
    grantee_user_id: found.id,
    permission_level: "view",
    granted_by: profile.id,
  });
  // A grant they already hold is not a failure — the nomination still stands.
  if (accessError && accessError.code !== "23505") {
    return { error: accessError.message };
  }

  revalidatePath("/patient/family");
  revalidatePath("/patient");
  return {
    message: `${full_name} is now your next of kin. They can see your care activity and we'll contact them if something urgent comes up. They cannot change anything on your record.`,
  };
}

/**
 * Withdraws someone's view of this record. Only ever deletes a grant over the
 * caller's own profile — profile_access' DELETE policy is scoped to
 * profile_id = auth.uid(), so a grantee cannot use this to remove a rival
 * grantee, or to remove the record owner's own control.
 *
 * The emergency contact details are left in place: being reachable in a crisis
 * and being able to read the record are separate permissions, and revoking the
 * second is not a reason to silently drop the first.
 */
export async function revokeCareAccessAction(
  grantId: string
): Promise<{ message: string } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profile_access")
    .delete()
    .eq("id", grantId)
    .eq("profile_id", profile.id);
  if (error) return { error: error.message };

  revalidatePath("/patient/family");
  return { message: "Access withdrawn." };
}
