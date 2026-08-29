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
  /** Subset of elevatedConditions tiered 'high' or 'very_high' specifically
   * (not just "above low") — §78.17 high-risk-condition safety-layer
   * signal, kept separate from elevatedConditions so graph.ts can react
   * with extra caution rather than lumping moderate/high/very_high/unknown
   * together the way the plain "above low" list does. */
  highRiskConditions: string[];
  /** From patient_pregnancy.is_pregnant — §78.17 pregnancy safety-layer
   * signal. False when no row exists (never assumed true from absence). */
  isPregnant: boolean;
  /** profiles.date_of_birth-derived, best-effort — §78.17 paediatric
   * safety-layer signal. This platform is individual-enrolment-only (no
   * ParentCare/family plans, no dependent-minor profiles by design — see
   * CLAUDE.md), so a genuinely paediatric patient shouldn't normally occur
   * here; this is a defensive check for the case a self-registered account
   * turns out to belong to a minor, not a claim that paediatric care is a
   * supported product surface. Null when date_of_birth isn't on file. */
  possibleMinor: boolean | null;
  /** The patient's active/paused/etc lifestyle programme enrolments, so a
   * reply can be grounded in their real condition/phase/goals rather than
   * generic health chat — see graph.ts's contextLine composition. */
  lifestyleProgrammes: LifestyleProgrammeContext[];
}

const MINOR_AGE_CUTOFF = 18;

/** `now` is injectable (same convention as ai-coach/lagos-day.ts's
 * startOfLagosDayUtc) so age-boundary behaviour is testable without the
 * result depending on whatever day the test happens to run. */
export function isPossiblyMinor(dateOfBirth: string | null, now: Date = new Date()): boolean | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  let age = now.getFullYear() - dob.getFullYear();
  const hasHadBirthdayThisYear =
    now.getMonth() > dob.getMonth() ||
    (now.getMonth() === dob.getMonth() && now.getDate() >= dob.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age < MINOR_AGE_CUTOFF;
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
  const [riskScores, pregnancy, profile] = await Promise.all([
    supabase
      .from("prevention_risk_scores")
      .select("condition, tier")
      .eq("profile_id", profileId)
      .neq("tier", "low"),
    supabase.from("patient_pregnancy").select("is_pregnant").eq("patient_id", profileId).maybeSingle(),
    supabase.from("profiles").select("date_of_birth").eq("id", profileId).maybeSingle(),
  ]);

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

  const conditionRows = riskScores.data ?? [];
  return {
    elevatedConditions: conditionRows.map((row) => row.condition),
    highRiskConditions: conditionRows
      .filter((row) => row.tier === "high" || row.tier === "very_high")
      .map((row) => row.condition),
    isPregnant: pregnancy.data?.is_pregnant ?? false,
    possibleMinor: isPossiblyMinor(profile.data?.date_of_birth ?? null),
    lifestyleProgrammes,
  };
}
