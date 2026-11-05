"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { addChildDependentSchema } from "@/lib/validation/add-child-dependent";
import { generateVaccinationScheduleBestEffort } from "@/lib/preventive/generate-vaccination-schedule";
import { ageFromDateOfBirth } from "@tarragon/shared";
import { ABUSE_LIMIT_MESSAGE, checkAbuseLimit } from "@/lib/security/abuse-limits";

/**
 * Provisions a child the parent keeps a vaccination card and health record
 * for — someone who has never signed up and cannot, because they are too young
 * to hold an account.
 *
 * profiles.id is a hard FK to auth.users(id), so there's no way to represent
 * "a health record with nobody behind it" other than a real auth user with
 * no usable credentials: a synthetic, non-deliverable email (nobody can ever
 * receive a magic link there) and no password set (same auth.admin.createUser
 * shape as /admin/settings/members' provisioning, minus the password field).
 *
 * The child inherits the parent's organisation_id and is linked by exactly one
 * thing: a profile_access grant at level 'manage', which is what the already-
 * built vaccination_records/vaccination_schedules RLS checks before letting the
 * parent log and view doses. Until removal 4 (20260729143514) this also wrote a
 * family_plan_members row to put the child on the parent's bill; enrolment is
 * individual now, and a child's record was never a billing relationship in the
 * first place — it is a consent one.
 *
 * profiles.is_dependent_account is stamped true here and here only. It is
 * what keeps this child out of the eldercare 'manage' surfaces (an adult
 * granted/accepted care_access_requests access) and keeps an eldercare-
 * managed adult out of this surface's "children you look after" list — both
 * paths write an identical profile_access row, and this column is the only
 * thing that tells them apart.
 */
export async function addChildDependentAction(
  input: unknown
): Promise<{ message: string } | { error: string }> {
  const parsed = addChildDependentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }
  const { full_name, date_of_birth, sex } = parsed.data;

  const parent = await getCurrentProfile();
  if (!parent) return { error: "Not signed in" };
  if (!parent.organisation_id) return { error: "This account has no organisation on file" };
  // Only a patient's own signed-in account adds a child (security audit 2026-11-05, M-8): this creates a real auth user
  // through the service role, so a staff account or a dependant's record must never reach it.
  if (parent.role !== "patient" || parent.is_dependent_account) {
    return { error: "Only a patient's own account can add a child." };
  }
  const limited = await checkAbuseLimit("add_dependant", parent.id);
  if (!limited.ok) return { error: ABUSE_LIMIT_MESSAGE };

  const svc = createServiceRoleClient();

  const syntheticEmail = `dependent+${randomUUID()}@dependents.tarragonhealth.internal`;
  const { data: created, error: createError } = await svc.auth.admin.createUser({
    email: syntheticEmail,
    email_confirm: true,
    app_metadata: { role: "patient", organisation_id: parent.organisation_id, signup_exempt: "true" },
    user_metadata: { full_name },
  });
  if (createError || !created.user) {
    if (createError) console.error("addChildDependentAction: createUser failed", createError.message);
    return { error: "Could not create the child's record. Please try again." };
  }
  const childId = created.user.id;

  // Routed through an RPC (rather than a raw .update()) so the write can be attributed to the
  // provisioning parent in public.audit_log despite running on the service-role client — see
  // 20260812041044_service_role_write_actor_attribution.sql.
  const { error: updateError } = await svc.rpc("provision_dependent_profile_basics", {
    p_child_id: childId,
    p_date_of_birth: date_of_birth,
    p_sex: (sex ?? null) as unknown as "male" | "female",
    p_actor_id: parent.id,
  });
  if (updateError) {
    console.error("addChildDependentAction: profile setup failed", updateError.message);
    await removeHalfMadeChild(svc, childId);
    return { error: "Could not create the child's record. Please try again." };
  }

  const { error: accessError } = await svc.from("profile_access").insert({
    profile_id: childId,
    grantee_user_id: parent.id,
    permission_level: "manage",
    granted_by: parent.id,
  });
  if (accessError) {
    console.error("addChildDependentAction: access grant failed", accessError.message);
    await removeHalfMadeChild(svc, childId);
    return { error: "Could not create the child's record. Please try again." };
  }

  // Best-effort: populate the child's vaccination card immediately rather
  // than waiting for the first dose log or a cron to materialise it.
  await generateVaccinationScheduleBestEffort({
    patientId: childId,
    organisationId: parent.organisation_id,
    ageYears: ageFromDateOfBirth(date_of_birth),
  });

  revalidatePath("/patient/family");
  revalidatePath("/patient");
  return { message: `Added ${full_name} to your family.` };
}

/** A child record that failed part-way has no parent link, so nobody could ever see or remove it. Delete the login behind it. */
async function removeHalfMadeChild(svc: ReturnType<typeof createServiceRoleClient>, childId: string): Promise<void> {
  const { error } = await svc.auth.admin.deleteUser(childId);
  if (error) console.error("addChildDependentAction: could not remove a half-made child record", childId, error.message);
}
