import { createClient, getCurrentUser } from "@/lib/supabase/server";

/** The signed-in caller's own profile row (RLS-scoped — no service role needed). */
export async function getCurrentProfile() {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  return profile;
}

/**
 * The signed-in caller's own active clinical_staff record, if any —
 * carries doctor_tier/is_clinical_director for tier-gated dashboard views
 * (docs/Tarragon_Health_Master_Operating_Plan_v4.md §4). Null for accounts
 * with no clinical_staff row (e.g. a doctor-role login not yet added to
 * clinical_staff) — never inferred/defaulted, per CLAUDE.md's "never infer
 * a doctor_tier in code" rule.
 */
export async function getCurrentClinicalStaff() {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return null;

  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("doctor_tier, is_clinical_director")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();
  return staff;
}
