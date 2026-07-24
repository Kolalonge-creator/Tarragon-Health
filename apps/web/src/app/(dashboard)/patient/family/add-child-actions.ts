"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { addChildDependentSchema } from "@/lib/validation/add-child-dependent";
import { generateVaccinationScheduleBestEffort } from "@/lib/preventive/generate-vaccination-schedule";
import { ageFromDateOfBirth } from "@tarragon/shared";

/**
 * Provisions a child family member the parent keeps a vaccination card and
 * health record for — the one family_plan_members relationship that has
 * never signed up and never will (every other relationship links to an
 * *existing* account via find_profile_by_phone).
 *
 * profiles.id is a hard FK to auth.users(id), so there's no way to represent
 * "a health record with nobody behind it" other than a real auth user with
 * no usable credentials: a synthetic, non-deliverable email (nobody can ever
 * receive a magic link there) and no password set (same auth.admin.createUser
 * shape as /admin/settings/members' provisioning, minus the password field).
 * The child inherits the parent's organisation_id and is linked two ways:
 * family_plan_members (household/billing bundling — plan_id left null, so it
 * counts against the free base cap of 4, not a paid tier) and profile_access
 * ('manage', so the already-built vaccination_records/vaccination_schedules
 * RLS — which checks profile_access — lets the parent log and view doses).
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

  const svc = createServiceRoleClient();

  const syntheticEmail = `dependent+${randomUUID()}@dependents.tarragonhealth.internal`;
  const { data: created, error: createError } = await svc.auth.admin.createUser({
    email: syntheticEmail,
    email_confirm: true,
    app_metadata: { role: "patient", organisation_id: parent.organisation_id },
    user_metadata: { full_name },
  });
  if (createError || !created.user) {
    return { error: createError?.message ?? "Could not create the child's record" };
  }
  const childId = created.user.id;

  const { error: updateError } = await svc
    .from("profiles")
    .update({ date_of_birth, sex: sex ?? null })
    .eq("id", childId);
  if (updateError) {
    return { error: updateError.message };
  }

  const { error: familyError } = await svc.from("family_plan_members").insert({
    organisation_id: parent.organisation_id,
    plan_owner_id: parent.id,
    member_id: childId,
    relationship: "child",
  });
  if (familyError) {
    return { error: familyError.message };
  }

  const { error: accessError } = await svc.from("profile_access").insert({
    profile_id: childId,
    grantee_user_id: parent.id,
    permission_level: "manage",
    granted_by: parent.id,
  });
  if (accessError) {
    return { error: accessError.message };
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
