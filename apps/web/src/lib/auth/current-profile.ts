import { createClient, getCurrentUser } from "@/lib/supabase/server";

/**
 * The signed-in caller's own profile row (RLS-scoped — no service role needed).
 * Returns null for a deactivated account (profiles.is_active = false), the
 * same as a signed-out caller — every page guard and server action in the app
 * already does `if (!profile) redirect(...)`/`throw ...` on a null return, so
 * this single choke point is what makes suspending a login (see
 * 20260925093444_enforce_profiles_is_active_in_core_authz.sql, which made
 * is_active a real RLS-level gate) actually cut off the app-layer permission
 * mirror too — not just the raw is_org_staff/is_admin/has_permission RLS
 * checks. Without this, a deactivated super admin's still-valid session would
 * keep passing every requirePermission() check and could still reach a
 * service-role-backed action (e.g. provisionMemberAction's
 * auth.admin.createUser) that bypasses RLS entirely.
 */
export async function getCurrentProfile() {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (!profile?.is_active) return null;
  return profile;
}

/**
 * The signed-in caller's own active clinical_staff record, if any — carries
 * doctor_tier for tier-gated dashboard views
 * (docs/Tarragon_Health_Master_Operating_Plan_v4.md §4). Governance
 * authority (protocol sign-off, case assignment, caseload visibility) is
 * intrinsic to doctor_tier = 'chief_medical_officer', not a separate flag.
 * Null for accounts with no clinical_staff row (e.g. a doctor-role login not
 * yet added to clinical_staff) — never inferred/defaulted, per CLAUDE.md's
 * "never infer a doctor_tier in code" rule.
 */
export async function getCurrentClinicalStaff() {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return null;

  const { data: staff } = await supabase
    .from("clinical_staff")
    .select(
      "id, staff_number, doctor_tier, specialty, credential_type, credential_number"
    )
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();
  return staff;
}
