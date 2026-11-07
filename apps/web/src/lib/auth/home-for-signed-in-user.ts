import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { isActiveChiefMedicalOfficer } from "@/lib/clinical/doctor-tier";
import { getRoleHomePath } from "./roles";

/** Where an active Chief Medical Officer lands after signing in (founder decision 2026-11-07). */
export const CMO_HOME_PATH = "/clinician/leadership";

/**
 * The role home, except that an active Chief Medical Officer lands on the Clinical Leadership Overview. The account role stays
 * `clinician` (never re-split by tier); this only chooses the first page, from clinical_staff.doctor_tier. If the tier cannot be
 * read, the ordinary clinician home is used, which the CMO can always reach the overview from.
 */
export async function homeForSignedInUser(
  supabase: SupabaseClient<Database>,
  userId: string,
  role: Database["public"]["Enums"]["user_role"]
): Promise<string> {
  const home = getRoleHomePath(role);
  if (role !== "clinician") return home;
  // It runs in proxy.ts and the sign-in actions, so a failure must never become an error page: any throw means the role home.
  try {
    const { data: staff, error } = await supabase
      .from("clinical_staff")
      .select("doctor_tier, active")
      .eq("profile_id", userId)
      .maybeSingle();
    return !error && isActiveChiefMedicalOfficer(staff ?? null) ? CMO_HOME_PATH : home;
  } catch {
    return home;
  }
}
