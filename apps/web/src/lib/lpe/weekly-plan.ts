/**
 * Weekly Plan — a read view over the patient's active LPE goal instances,
 * their completion streak, and "done today" state.
 *
 * IMPORTANT: this does NOT read `lpe_task_instances`. That table exists in
 * the LPE Phase 1 schema (20260719120001_lpe_foundation.sql) but nothing in
 * this codebase ever populates it — `lpe_task_templates` has zero seed rows
 * (checked: only `lpe_goal_templates` was seeded, in
 * 20260719123000_lpe_seed_templates.sql) and no materialisation job exists.
 * Building that pipeline (parsing task_templates.schedule's "cron-like +
 * windows" jsonb, generating rows, handling regeneration) is its own
 * project. Instead this reads what's already real: active
 * `lpe_goal_instances` (populated by lib/lifestyle/service.ts's
 * enrollPatient) and `lpe_measurements` (the unified lifestyle-measurement
 * store every goal's metric already logs into). "This week's plan" is the
 * patient's active goals; "done" is a measurement of the matching type
 * logged today/this week.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { evaluateStreak, type StreakResult } from "@tarragon/lifestyle-engine";
import { startOfLagosDayUtc } from "@/lib/ai-coach/lagos-day";

type LpeModule = Database["public"]["Enums"]["lpe_module"];
type LpeMeasurementType = Database["public"]["Enums"]["lpe_measurement_type"];

/** Only the goal metric keys actually seeded (20260719123000) map to a
 * loggable measurement type. A goal with any other/no metric_key still
 * shows on the plan, just without a streak (nothing to count). */
const MEASUREMENT_TYPE_BY_METRIC_KEY: Partial<Record<string, LpeMeasurementType>> = {
  food_log: "food_log",
  activity_minutes: "activity_minutes",
  weight: "weight",
  bp: "bp",
  glucose: "glucose",
};

const STREAK_WINDOW_DAYS = 14;

export type WeeklyPlanGoal = {
  id: string;
  organisationId: string;
  enrollmentId: string;
  module: LpeModule;
  title: string;
  measurementType: LpeMeasurementType | null;
  cadence: "daily" | "weekly";
  doneToday: boolean;
  doneThisWeek: boolean;
  streak: StreakResult;
  /** Oldest-first outcome for each of the last `STREAK_WINDOW_DAYS` Lagos
   * calendar days (today last) — same data `streak` is computed from, kept
   * around so a UI can render an actual trend instead of just the current
   * streak length. Reversed from `buildDailyOutcomeSeries`'s most-recent-first
   * order, which exists to match `evaluateStreak`'s expected input. */
  last14Days: ("done" | "missed")[];
};

export type WeeklyPlanView = {
  goals: WeeklyPlanGoal[];
  /** Daily-cadence goals only — a weekly check-in isn't "due today". */
  doneToday: number;
  totalToday: number;
};

const LAGOS_OFFSET_MS = 60 * 60 * 1000;

/**
 * The Lagos calendar-day key (YYYY-MM-DD) for a UTC instant. NOT the same as
 * slicing the ISO string directly: `startOfLagosDayUtc`'s own return value is
 * deliberately the UTC instant of Lagos *midnight*, which lands at 23:00 UTC
 * on the *previous* UTC calendar day — slicing that string reads yesterday.
 * This shifts by the same offset before slicing so it always reads the
 * correct Lagos date, for both `taken_at` timestamps and day-boundary
 * instants computed from `startOfLagosDayUtc`.
 */
function lagosDateKey(iso: string): string {
  return new Date(new Date(iso).getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

/** Pure — most-recent-first isn't required; only membership matters. Fills
 * `days` back from `today` (inclusive) with done/missed, Lagos calendar
 * days, most-recent-first (evaluateStreak reads outcomes in that order). */
export function buildDailyOutcomeSeries(
  loggedDateKeys: ReadonlySet<string>,
  today: Date,
  days = STREAK_WINDOW_DAYS
): ("done" | "missed")[] {
  const outcomes: ("done" | "missed")[] = [];
  const startOfToday = startOfLagosDayUtc(today);
  for (let i = 0; i < days; i++) {
    const d = new Date(startOfToday.getTime() - i * 86_400_000);
    outcomes.push(loggedDateKeys.has(lagosDateKey(d.toISOString())) ? "done" : "missed");
  }
  return outcomes;
}

/** Monday-start Lagos week containing `today`. */
function startOfLagosWeekUtc(today: Date): Date {
  const startToday = startOfLagosDayUtc(today);
  // getUTCDay on a Lagos-midnight-as-UTC instant reads the Lagos weekday.
  const lagosWeekday = new Date(startToday.getTime() + LAGOS_OFFSET_MS).getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (lagosWeekday + 6) % 7;
  return new Date(startToday.getTime() - daysSinceMonday * 86_400_000);
}

/**
 * The shared per-goal computation behind both `getWeeklyPlan` (a patient's
 * own dashboard, all active enrolments) and `getEnrollmentAdherence` (a
 * clinician looking at one specific enrolment's programme, e.g. from the
 * lifestyle-review worklist) — one query path, scoped by whichever
 * enrolment ids the caller already knows it wants.
 */
async function getGoalsForEnrollments(
  db: SupabaseClient<Database>,
  patientId: string,
  enrollmentIds: string[]
): Promise<WeeklyPlanGoal[]> {
  if (!enrollmentIds.length) return [];

  const { data: programmeInstances, error: instancesError } = await db
    .from("lpe_programme_instances")
    .select("id, enrollment_id")
    .in("enrollment_id", enrollmentIds);
  if (instancesError) throw instancesError;
  if (!programmeInstances?.length) return [];

  const enrollmentIdByInstance = new Map(programmeInstances.map((p) => [p.id, p.enrollment_id]));

  const { data: goalRows, error: goalsError } = await db
    .from("lpe_goal_instances")
    .select(
      "id, organisation_id, programme_instance_id, module, title, metric_key, lpe_goal_templates(cadence)"
    )
    .in(
      "programme_instance_id",
      programmeInstances.map((p) => p.id)
    )
    .eq("status", "active");
  if (goalsError) throw goalsError;
  if (!goalRows?.length) return [];

  const now = new Date();
  const todayKey = lagosDateKey(startOfLagosDayUtc(now).toISOString());
  const weekStartKey = lagosDateKey(startOfLagosWeekUtc(now).toISOString());
  const windowStartIso = new Date(
    startOfLagosDayUtc(now).getTime() - (STREAK_WINDOW_DAYS - 1) * 86_400_000
  ).toISOString();

  const goals: WeeklyPlanGoal[] = [];
  for (const g of goalRows) {
    const enrollmentId = enrollmentIdByInstance.get(g.programme_instance_id);
    if (!enrollmentId) continue; // orphaned instance row — skip rather than crash the whole plan

    const cadence: "daily" | "weekly" =
      (g.lpe_goal_templates as { cadence: string | null } | null)?.cadence === "weekly"
        ? "weekly"
        : "daily";
    const measurementType = g.metric_key ? (MEASUREMENT_TYPE_BY_METRIC_KEY[g.metric_key] ?? null) : null;

    let loggedDateKeys = new Set<string>();
    if (measurementType) {
      const { data: measurements, error: measurementsError } = await db
        .from("lpe_measurements")
        .select("taken_at")
        .eq("patient_id", patientId)
        .eq("enrollment_id", enrollmentId)
        .eq("type", measurementType)
        .gte("taken_at", windowStartIso)
        .order("taken_at", { ascending: false });
      if (measurementsError) throw measurementsError;
      loggedDateKeys = new Set((measurements ?? []).map((m) => lagosDateKey(m.taken_at)));
    }

    const mostRecentFirst = buildDailyOutcomeSeries(loggedDateKeys, now);
    goals.push({
      id: g.id,
      organisationId: g.organisation_id,
      enrollmentId,
      module: g.module,
      title: g.title,
      measurementType,
      cadence,
      doneToday: loggedDateKeys.has(todayKey),
      doneThisWeek: [...loggedDateKeys].some((k) => k >= weekStartKey),
      streak: evaluateStreak(mostRecentFirst),
      last14Days: [...mostRecentFirst].reverse(),
    });
  }

  return goals;
}

export async function getWeeklyPlan(
  db: SupabaseClient<Database>,
  patientId: string
): Promise<WeeklyPlanView | null> {
  const { data: enrollments, error: enrollmentsError } = await db
    .from("lpe_enrollments")
    .select("id")
    .eq("patient_id", patientId)
    .eq("status", "active");
  if (enrollmentsError) throw enrollmentsError;
  if (!enrollments?.length) return null;

  const goals = await getGoalsForEnrollments(
    db,
    patientId,
    enrollments.map((e) => e.id)
  );
  if (!goals.length) return null;

  const dailyGoals = goals.filter((g) => g.cadence === "daily");
  return {
    goals,
    doneToday: dailyGoals.filter((g) => g.doneToday).length,
    totalToday: dailyGoals.length,
  };
}

/**
 * A clinician's read of one specific enrolment's goal adherence — e.g. from
 * the `/clinician/lifestyle-reviews` worklist, where `lpe_reviews` already
 * carries the `enrollment_id` to scope to (a patient with two active
 * enrolments, say diabetes and hypertension, gets two separate reviews and
 * should never see one enrolment's goals bleed into the other's row). Never
 * writes — clinicians view adherence, they don't log a patient's habits.
 */
export async function getEnrollmentAdherence(
  db: SupabaseClient<Database>,
  patientId: string,
  enrollmentId: string
): Promise<WeeklyPlanGoal[]> {
  return getGoalsForEnrollments(db, patientId, [enrollmentId]);
}

/** Whether a goal is satisfied for its own cadence — "done today" for a
 * daily goal, "done this week" for a weekly one. */
function isGoalSatisfied(goal: WeeklyPlanGoal): boolean {
  return goal.cadence === "weekly" ? goal.doneThisWeek : goal.doneToday;
}

/**
 * Orders goals by how much attention they need right now, most urgent
 * first — a goal 3+ misses deep, then one with a single recent miss, then
 * anything still outstanding, then whatever's already done today/this week.
 * Stable within each tier (`Array.prototype.sort` is stable), so goals that
 * don't need attention keep their original DB order rather than jumping
 * around on every render.
 */
export function sortGoalsByPriority(goals: WeeklyPlanGoal[]): WeeklyPlanGoal[] {
  const rank = (g: WeeklyPlanGoal): number => {
    if (isGoalSatisfied(g)) return 3;
    if (g.streak.shouldRaiseWorklistItem) return 0;
    if (g.streak.shouldNudge) return 1;
    return 2;
  };
  return [...goals].sort((a, b) => rank(a) - rank(b));
}

/**
 * The single goal most worth the patient's attention today, mirroring
 * `getPriorityHealthScoreTip`'s "one start-here suggestion instead of a flat
 * list to triage yourself" shape. Null when nothing is outstanding — same as
 * that function returning null when every component already clears
 * threshold; a patient who's on top of everything doesn't need a nudge.
 */
export function getPriorityWeeklyGoal(goals: WeeklyPlanGoal[]): WeeklyPlanGoal | null {
  const top = sortGoalsByPriority(goals)[0];
  return top && !isGoalSatisfied(top) ? top : null;
}

/**
 * A patient marking a goal done for today/this week. Writes a minimal
 * `lpe_measurements` row — the same store every real logged reading already
 * uses, `source: 'app'` (never 'whatsapp', see the LPE migration's own
 * comment on that enum). No `value_num`: this is a completion check-in, not
 * a physical reading, so `value_json` carries the (satisfied) `check`
 * constraint instead.
 */
export async function markGoalDone(
  db: SupabaseClient<Database>,
  goal: Pick<WeeklyPlanGoal, "organisationId" | "enrollmentId" | "measurementType">,
  patientId: string
): Promise<void> {
  if (!goal.measurementType) {
    throw new Error("This goal has no loggable metric to check off.");
  }
  const { error } = await db.from("lpe_measurements").insert({
    organisation_id: goal.organisationId,
    patient_id: patientId,
    enrollment_id: goal.enrollmentId,
    type: goal.measurementType,
    value_json: { completed: true },
    unit: "check",
    taken_at: new Date().toISOString(),
    source: "app",
  });
  if (error) throw error;
}
