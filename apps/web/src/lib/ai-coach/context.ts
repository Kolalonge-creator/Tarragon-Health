import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums } from "@tarragon/shared";
import { CONDITION_LABEL, getLifestyleState } from "@/lib/lifestyle/service";

/** One patient's lifestyle programme, as far as the coach needs to know.
 * Deliberately a different shape (and name-collision-avoiding name) from
 * @tarragon/lifestyle-engine's own, narrower `PatientContext` type
 * (isPregnant/hasEatingDisorderHistory/highRisk) — same name, different
 * package, different purpose; don't conflate them. */
export interface LifestyleProgrammeContext {
  /** Raw enum value (not just conditionLabel) so a caller can filter content
   * retrieval (find-relevant-content.ts) by it. */
  condition: Enums<"care_plan_condition">;
  conditionLabel: string;
  programmeName: string | null;
  currentPhaseName: string | null;
  status: string;
  goalTitles: string[];
  hasOpenRedFlag: boolean;
}

export interface PatientContext {
  /** Prevention conditions currently tiered above 'low', for a personalised
   * (not generic) reply — e.g. so the coach can say "since your diabetes
   * risk is elevated" rather than nothing. */
  elevatedConditions: string[];
  /** The patient's active/paused/etc lifestyle programme enrolments, so a
   * reply can be grounded in their real condition/phase/goals rather than
   * generic health chat — see graph.ts's contextLine composition. */
  lifestyleProgrammes: LifestyleProgrammeContext[];
}

/** Patient-wide (not per-enrollment) — matches the same scoping
 * coaching-run.ts already uses for its own red-flag check. RLS
 * (lpe_red_flag_events_select) permits a patient's own session to read
 * their own rows. */
async function hasOpenLpeRedFlag(
  supabase: SupabaseClient<Database>,
  profileId: string
): Promise<boolean> {
  const { count } = await supabase
    .from("lpe_red_flag_events")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", profileId)
    .eq("status", "open");
  return (count ?? 0) > 0;
}

/** Best-effort grounding snapshot. Never throws — a coach turn should still
 * proceed on generic advice if this lookup fails. */
export async function loadPatientContext(
  supabase: SupabaseClient<Database>,
  profileId: string
): Promise<PatientContext> {
  const { data } = await supabase
    .from("prevention_risk_scores")
    .select("condition, tier")
    .eq("profile_id", profileId)
    .neq("tier", "low");

  let lifestyleProgrammes: LifestyleProgrammeContext[] = [];
  try {
    const [enrollments, hasOpenRedFlag] = await Promise.all([
      getLifestyleState(supabase, profileId),
      hasOpenLpeRedFlag(supabase, profileId),
    ]);
    lifestyleProgrammes = enrollments.map((e) => ({
      condition: e.condition,
      conditionLabel: CONDITION_LABEL[e.condition] ?? e.condition,
      programmeName: e.programmeName,
      currentPhaseName: e.currentPhaseName,
      status: e.status,
      goalTitles: e.goals.map((g) => g.title),
      hasOpenRedFlag,
    }));
  } catch {
    // getLifestyleState wasn't written with a "never throws" guarantee —
    // preserve this function's own contract regardless.
  }

  return {
    elevatedConditions: (data ?? []).map((row) => row.condition),
    lifestyleProgrammes,
  };
}
