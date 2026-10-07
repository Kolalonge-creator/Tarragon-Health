import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import type { PatientContext } from "./context";

/**
 * S51 (spec 7.5): ONE daily nudge and a weekly reflection, built from the patient's own data by fixed rules. No model writes either: the
 * text is deterministic, so it cannot invent a fact, give a verdict or name a dose. (A model-polished version is a later, separate
 * AI call site and would be registered in ai_systems first.) The notification that points the patient here is a keyed generic template
 * (assistant_daily_nudge, assistant_weekly_reflection) that names nothing (INV-07); this text is shown only inside the app.
 *
 * Tone rules, same as the rest of the assistant: warm, no shame, no urgency, no verdict on a reading ("good", "normal", "controlled").
 */

export type DailyNudgeKind = "log_reading" | "medicines" | "goal" | "walk" | "rest";

export interface DailyNudge {
  kind: DailyNudgeKind;
  text: string;
  /** Where the nudge points, as an app section id (mobile) and a path (web). Fixed by kind, never model-supplied. */
  target: { section: "vitals" | "medications" | "lifestyle" | "today"; path: string };
}

const LAGOS_OFFSET_MS = 60 * 60 * 1000;

/** The Africa/Lagos calendar day (YYYY-MM-DD) of an instant. Lagos has no daylight saving. */
export function lagosDay(d: Date): string {
  return new Date(d.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday, in Lagos. */
export function lagosWeekday(d: Date): number {
  return new Date(d.getTime() + LAGOS_OFFSET_MS).getUTCDay();
}

/**
 * Picks the single nudge for today. Order is fixed and explained: a reading nudge only for someone who already logs readings (never to
 * start a stranger), then medicines for someone with active ones, then their own goal, then a plain walk. `readingToday` and
 * `medicinesLoggedToday` are facts the caller read; the function itself is pure so each branch is unit tested.
 */
export function chooseDailyNudge(input: {
  context: Pick<PatientContext, "recentVitals" | "activeMedications" | "lifestyleProgrammes">;
  readingToday: boolean;
  medicinesLoggedToday: boolean;
}): DailyNudge {
  const { context, readingToday, medicinesLoggedToday } = input;
  if (context.recentVitals.length > 0 && !readingToday) {
    return {
      kind: "log_reading",
      text: "A quick reading today keeps your picture up to date. It only takes a minute.",
      target: { section: "vitals", path: "/patient/vitals" },
    };
  }
  if (context.activeMedications.length > 0 && !medicinesLoggedToday) {
    return {
      kind: "medicines",
      text: "When you take your medicines today, tick them off so your record stays right.",
      target: { section: "medications", path: "/patient/medications" },
    };
  }
  // A programme the care team has paused, or that has an open red flag, gets NO encouragement to push on (the same rule the chat applies).
  const held = context.lifestyleProgrammes.some((p) => p.status === "paused" || p.hasOpenRedFlag);
  if (held) {
    return {
      kind: "rest",
      text: "Take today at your own pace. Your care team is here if you need them.",
      target: { section: "today", path: "/patient" },
    };
  }
  const goal = context.lifestyleProgrammes.flatMap((p) => p.goalTitles)[0];
  if (goal) {
    return {
      kind: "goal",
      text: "One small step towards your goal today is plenty.",
      target: { section: "lifestyle", path: "/patient/lifestyle" },
    };
  }
  return {
    kind: "walk",
    text: "A ten minute walk today counts. Go at your own pace.",
    target: { section: "today", path: "/patient" },
  };
}

export interface WeeklyReflection {
  readingsThisWeek: number;
  readingsLastWeek: number;
  medicinesTakenThisWeek: number;
  medicinesMissedThisWeek: number;
  text: string;
}

/** A read that failed is NOT zero. Counts that could not be read leave the reflection out rather than telling the patient something false. */
type Counted = number | null;

/** Plain counts and gentle wording only. Never a verdict on a value, never a comparison to a target. */
export function composeWeeklyReflection(c: {
  readingsThisWeek: number;
  readingsLastWeek: number;
  medicinesTakenThisWeek: number;
  medicinesMissedThisWeek: number;
}): WeeklyReflection {
  const parts: string[] = [];
  if (c.readingsThisWeek === 0 && c.readingsLastWeek === 0) {
    parts.push("You did not log a reading this week or last week. A reading whenever you can helps your care team see the full picture.");
  } else if (c.readingsThisWeek > c.readingsLastWeek) {
    parts.push(`You logged ${c.readingsThisWeek} reading${c.readingsThisWeek === 1 ? "" : "s"} this week, up from ${c.readingsLastWeek} last week. Thank you for keeping at it.`);
  } else if (c.readingsThisWeek === c.readingsLastWeek) {
    parts.push(`You logged ${c.readingsThisWeek} reading${c.readingsThisWeek === 1 ? "" : "s"} this week, the same as last week. Steady is good.`);
  } else {
    parts.push(`You logged ${c.readingsThisWeek} reading${c.readingsThisWeek === 1 ? "" : "s"} this week, and ${c.readingsLastWeek} last week. A little more next week would help.`);
  }
  const doses = c.medicinesTakenThisWeek + c.medicinesMissedThisWeek;
  if (doses > 0) {
    parts.push(`You marked ${c.medicinesTakenThisWeek} of ${doses} medicine doses as taken. If anything is making them hard to take, tell your care team.`);
  }
  parts.push("Pick one small thing to carry into next week.");
  return { ...c, text: parts.join(" ") };
}

function weekAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Reads the counts the reflection needs. A read that errors (supabase-js returns { error }, it does not throw) makes the whole reflection
 *  unavailable (null): the card is simply not shown, never a false "you logged nothing". */
export async function buildWeeklyReflection(
  supabase: SupabaseClient<Database>,
  patientId: string,
  now: Date = new Date()
): Promise<WeeklyReflection | null> {
  const count = async (run: () => PromiseLike<{ count: number | null; error: unknown }>): Promise<Counted> => {
    try {
      const { count: n, error } = await run();
      return error ? null : (n ?? 0);
    } catch {
      return null;
    }
  };
  const readings = (from: string, to: string) =>
    count(() =>
      supabase
        .from("vitals_readings")
        .select("id", { count: "exact", head: true })
        .eq("patient_id", patientId)
        .gte("taken_at", from)
        .lt("taken_at", to)
    );
  const meds = (status: "taken" | "missed") =>
    count(() =>
      supabase
        .from("medication_logs")
        .select("id", { count: "exact", head: true })
        .eq("patient_id", patientId)
        .eq("status", status)
        .gte("logged_at", weekAgo(now, 7))
    );
  const [readingsThisWeek, readingsLastWeek, medicinesTakenThisWeek, medicinesMissedThisWeek] = await Promise.all([
    readings(weekAgo(now, 7), now.toISOString()),
    readings(weekAgo(now, 14), weekAgo(now, 7)),
    meds("taken"),
    meds("missed"),
  ]);
  if (readingsThisWeek === null || readingsLastWeek === null || medicinesTakenThisWeek === null || medicinesMissedThisWeek === null) return null;
  return composeWeeklyReflection({ readingsThisWeek, readingsLastWeek, medicinesTakenThisWeek, medicinesMissedThisWeek });
}

/** Reads the two facts the daily nudge needs and chooses it. */
export async function buildDailyNudge(
  supabase: SupabaseClient<Database>,
  patientId: string,
  context: Pick<PatientContext, "recentVitals" | "activeMedications" | "lifestyleProgrammes">,
  now: Date = new Date()
): Promise<DailyNudge> {
  const startOfLagosDay = new Date(`${lagosDay(now)}T00:00:00+01:00`).toISOString();
  let readingToday = false;
  let medicinesLoggedToday = false;
  try {
    const { count, error } = await supabase
      .from("vitals_readings")
      .select("id", { count: "exact", head: true })
      .eq("patient_id", patientId)
      .gte("taken_at", startOfLagosDay);
    readingToday = !error && (count ?? 0) > 0;
  } catch {
    // unknown counts as "not yet", which only means a gentle reminder
  }
  try {
    const { count, error } = await supabase
      .from("medication_logs")
      .select("id", { count: "exact", head: true })
      .eq("patient_id", patientId)
      .eq("status", "taken")
      .gte("logged_at", startOfLagosDay);
    medicinesLoggedToday = !error && (count ?? 0) > 0;
  } catch {
    // same
  }
  return chooseDailyNudge({ context, readingToday, medicinesLoggedToday });
}
