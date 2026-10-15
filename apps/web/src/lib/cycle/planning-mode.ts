import type { SupabaseClient } from "@supabase/supabase-js";
import { isPlanningMode } from "@/lib/rules/cycle-fertile-mode";

/**
 * Reads the saved "Planning a pregnancy" choice (S85 D2, OQ-12).
 *
 * Off is the safe state, so every way this can fail reads as off: no profile row, a null, a column that has not been
 * deployed yet, a refused read (a caregiver without the reproductive_health category), a network error. It is read on
 * its own, not folded into the page's other profile select, so a missing column can never take the life stage and
 * average cycle length down with it.
 */
export async function readPlanningMode(
  supabase: Pick<SupabaseClient, "from">,
  patientId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("reproductive_health_profiles")
      .select("planning_pregnancy_mode")
      .eq("patient_id", patientId)
      .maybeSingle();
    if (error) return false;
    return isPlanningMode((data as { planning_pregnancy_mode?: boolean | null } | null)?.planning_pregnancy_mode);
  } catch {
    return false;
  }
}
