"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import {
  nominateNextOfKinSchema,
  eldercareAccessRequestSchema,
  inverseRelationship,
  CAREGIVER_PERMISSIONS,
  type CaregiverPermission,
} from "@/lib/validation/care-access";

/**
 * Names a next of kin: the person Tarragon contacts if something goes wrong,
 * and — when they hold a Tarragon account of their own and accept — the
 * person who may watch this record without being able to change it.
 *
 * The two halves are deliberately independent, because they fail differently:
 *
 *   contactability  always recorded, on the caller's own profiles row, which
 *                   is where private.handle_emergency_event and
 *                   private.notify_unacknowledged_emergencies already read the
 *                   emergency contact from. Works for a next of kin who has
 *                   never heard of Tarragon.
 *   visibility      only when the phone number matches a real account, AND
 *                   only once that account accepts — see
 *                   care_access_requests / respond_to_care_access_request.
 *                   Naming someone here no longer hands out access on the
 *                   spot: it creates a pending request so a mistyped number
 *                   or an unwilling next of kin can't be silently handed a
 *                   view of somebody's care.
 *
 * 'view' is the whole point of the resulting grant and is enforced by the
 * database, not by this function: every RLS policy that admits a
 * profile_access grantee to a write (vaccination_records,
 * reproductive_health_profiles, booking_requests) requires level 'manage'. A
 * next of kin sees the record and cannot edit it. 'manage' between two adults
 * who each hold their own account is the eldercare case — see
 * createEldercareAccessRequestAction below. 'manage' for a child dependant
 * who has no login of their own is a different, unconditional path — see
 * addChildDependentAction.
 *
 * Runs on the caller's own RLS-scoped client, never service role: the
 * care_access_requests INSERT policy requires initiated_by = auth.uid() AND
 * the caller be one of the two named parties, so the database itself
 * guarantees a person can only ever propose giving away access to their own
 * record (or accepting responsibility for someone else's, in the eldercare
 * case), never take it over someone else's without that person's own accept.
 * That check is not duplicated here because it must not be duplicated — one
 * place to be wrong is better than two.
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
      message: `${full_name} is now your next of kin. We'll contact them if something urgent comes up. They don't have a Tarragon account on that number yet, so there's nothing for them to view yet: add them again once they sign up and they'll be able to follow your care.`,
    };
  }

  const { data: existingGrant } = await supabase
    .from("profile_access")
    .select("id")
    .eq("profile_id", profile.id)
    .eq("grantee_user_id", found.id)
    .maybeSingle();
  if (existingGrant) {
    return {
      message: `${full_name} is now your next of kin. They can already see your care activity.`,
    };
  }

  const { data: existingRequest } = await supabase
    .from("care_access_requests")
    .select("id")
    .eq("profile_id", profile.id)
    .eq("counterparty_user_id", found.id)
    .eq("status", "pending")
    .maybeSingle();
  if (existingRequest) {
    return {
      message: `${full_name} is now your next of kin. We already asked them to confirm before they can see your care activity, waiting on them.`,
    };
  }

  const { error: requestError } = await supabase.from("care_access_requests").insert({
    profile_id: profile.id,
    counterparty_user_id: found.id,
    initiated_by: profile.id,
    permission_level: "view",
    relationship,
  });
  // A duplicate proposal is not a failure — the nomination still stands.
  if (requestError && requestError.code !== "23505") {
    return { error: requestError.message };
  }

  revalidatePath("/patient/family");
  revalidatePath("/patient");
  return {
    message: `${full_name} is now your next of kin. We've asked them to confirm before they can see your care activity; they'll get a notification and can accept any time.`,
  };
}

/**
 * Resolves a phone number to a real, named Tarragon account (same-org,
 * patient role only — find_profile_by_phone's own restriction) without
 * creating anything. Backs the eldercare wizard's review step, so a person
 * confirms a real name before a request is sent rather than trusting
 * whatever they typed.
 */
export async function lookupCareAccessCandidateAction(
  phone: string
): Promise<{ id: string; full_name: string | null } | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createClient();
  const { data: found } = await supabase
    .rpc("find_profile_by_phone", { lookup_phone: phone })
    .maybeSingle();
  if (!found || found.id === profile.id) return null;
  return found;
}

/**
 * The eldercare "manage" request — an adult granting, or asking for, write
 * access over a record between two people who each already hold their own
 * account. Deliberately a proposal, not a grant: whichever party did NOT
 * click this form must still accept before profile_access changes at all —
 * see respond_to_care_access_request, which is the only path that turns a
 * pending row here into a real grant.
 */
export async function createEldercareAccessRequestAction(
  input: unknown
): Promise<{ message: string } | { error: string }> {
  const parsed = eldercareAccessRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }
  const { phone, relationship, direction, permissions, duration } = parsed.data;

  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in" };

  const supabase = await createClient();

  const { data: found } = await supabase
    .rpc("find_profile_by_phone", { lookup_phone: phone })
    .maybeSingle();
  if (!found || found.id === profile.id) {
    return {
      error:
        "We couldn't find a Tarragon account on that number in your organisation. They need their own account first: ask them to sign up, then try again.",
    };
  }

  // i_will_manage: the caller keeps their own record and offers the found
  // person 'manage' access over it — profile_id is the caller. The form
  // asked "their relationship to you", i.e. found's relationship to the
  // owner — already the canonical (owner-relative) direction, store as-is.
  // i_will_help: the caller offers to manage the found person's record —
  // profile_id is the found person, the caller is the counterparty. The form
  // still asked "their [found/owner's] relationship to you [the caller]",
  // which is backwards from canonical — invert it before storing (see
  // inverseRelationship's doc comment).
  const profileId = direction === "i_will_manage" ? profile.id : found.id;
  const counterpartyUserId = direction === "i_will_manage" ? found.id : profile.id;
  const canonicalRelationship =
    direction === "i_will_manage" ? relationship : inverseRelationship(relationship);

  // Every capability checked is what "unrestricted" looks like in the
  // wizard — store null, the same value every manage grant made before this
  // feature existed already carries, rather than a nine-item array that
  // happens to spell out "everything."
  const uniquePermissions = new Set<CaregiverPermission>(permissions);
  const permissionsToStore =
    uniquePermissions.size >= CAREGIVER_PERMISSIONS.length ? null : Array.from(uniquePermissions);

  const expiresAtToStore =
    duration === "permanent"
      ? null
      : new Date(Date.now() + Number(duration) * 24 * 60 * 60 * 1000).toISOString();

  const { error: insertError } = await supabase.from("care_access_requests").insert({
    profile_id: profileId,
    counterparty_user_id: counterpartyUserId,
    initiated_by: profile.id,
    permission_level: "manage",
    relationship: canonicalRelationship,
    permissions: permissionsToStore,
    expires_at: expiresAtToStore,
  });
  if (insertError) {
    if (insertError.code === "23505") {
      return { error: "There's already a pending request between you and this person." };
    }
    return { error: insertError.message };
  }

  revalidatePath("/patient/family");
  return {
    message:
      direction === "i_will_manage"
        ? `Request sent to ${found.full_name ?? "them"}. Once they accept, they'll be able to manage bookings and records on your behalf.`
        : `Request sent to ${found.full_name ?? "them"}. Once they accept, you'll be able to manage bookings and records on their behalf.`,
  };
}

/**
 * Accepts or declines a pending care_access_requests row. All the actual
 * validation — who is allowed to respond, whether the request is still
 * pending — happens inside respond_to_care_access_request itself, which is
 * SECURITY DEFINER precisely because the owner-offers direction needs the
 * counterparty to accept, and that write (profile_id = the owner, not the
 * caller) cannot pass through a plain RLS-scoped insert. Nothing here is
 * trusted beyond "call the RPC with what the caller sent."
 */
export async function respondToCareAccessRequestAction(
  requestId: string,
  accept: boolean
): Promise<{ message: string } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_to_care_access_request", {
    p_request_id: requestId,
    p_accept: accept,
  });
  if (error) return { error: error.message };

  revalidatePath("/patient/family");
  revalidatePath("/patient");
  return {
    message: accept
      ? "Accepted. That access is active now."
      : "Declined. No access was given.",
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

/**
 * Withdraws a request the caller sent before the other party has responded.
 * care_access_requests_update_cancel (the RLS policy) only admits
 * initiated_by = auth.uid() AND status = 'pending' going to 'cancelled' —
 * nothing else about the row is reachable through this path, so there is no
 * plain-client route from here to accepting your own request.
 */
export async function cancelCareAccessRequestAction(
  requestId: string
): Promise<{ message: string } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("care_access_requests")
    .update({ status: "cancelled" })
    .eq("id", requestId)
    .eq("initiated_by", profile.id)
    .eq("status", "pending");
  if (error) return { error: error.message };

  revalidatePath("/patient/family");
  return { message: "Request withdrawn." };
}
