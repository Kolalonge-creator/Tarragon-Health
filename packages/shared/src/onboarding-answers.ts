/**
 * S41 (spec 1.10, 1.11): the goal and condition choices a person makes in onboarding, and what Home and the plan preview
 * do with them.
 *
 * The option CODES are mirrored from `private.onboarding_option_ok` in the S41 migration; a scan test
 * (`onboarding-answers.test.ts`) fails if the two drift. The words shown to people live in `@tarragon/i18n`
 * (`onb.goal.*`, `onb.condition.*`), never here.
 *
 * Nothing in here is a clinical value. A condition choice is what the person says about themselves, never a diagnosis, and
 * it only decides which cards lead on Home. It never changes a threshold, a rule or a recommendation to take a medicine.
 */

export const GOAL_CODES = ["manage_condition", "stay_ahead", "screening_check", "family_care", "not_sure"] as const;
export type GoalCode = (typeof GOAL_CODES)[number];

export const CONDITION_CODES = ["hypertension", "diabetes", "asthma", "kidney", "heart", "other", "none"] as const;
export type ConditionCode = (typeof CONDITION_CODES)[number];

export interface OnboardingAnswers {
  readonly goals: readonly GoalCode[];
  readonly conditions: readonly ConditionCode[];
}

export type AnswersValidation = { ok: true; value: OnboardingAnswers } | { ok: false; reason: "goals" | "conditions" | "mixed" };

/** The same rules as `save_onboarding_answers`: 1 to 5 goals, 1 to 6 conditions, known codes, "not sure" and "none" stand alone. */
export function validateOnboardingAnswers(goals: readonly string[], conditions: readonly string[]): AnswersValidation {
  const g = [...new Set(goals)];
  const c = [...new Set(conditions)];
  if (g.length < 1 || g.length > 5 || !g.every((x): x is GoalCode => (GOAL_CODES as readonly string[]).includes(x))) {
    return { ok: false, reason: "goals" };
  }
  if (c.length < 1 || c.length > 6 || !c.every((x): x is ConditionCode => (CONDITION_CODES as readonly string[]).includes(x))) {
    return { ok: false, reason: "conditions" };
  }
  if ((g.includes("not_sure") && g.length > 1) || (c.includes("none") && c.length > 1)) return { ok: false, reason: "mixed" };
  return { ok: true, value: { goals: g as GoalCode[], conditions: c as ConditionCode[] } };
}

/** What a Home card points at. `id` is a stable key, `href` is a route in apps/web. */
export interface FocusItem {
  readonly id: "log_readings" | "medicines" | "health_check" | "vaccines" | "family" | "explore";
  readonly href: string;
}

const FOCUS_BY_ID: Record<FocusItem["id"], FocusItem> = {
  log_readings: { id: "log_readings", href: "/patient/vitals" },
  medicines: { id: "medicines", href: "/patient/medications" },
  health_check: { id: "health_check", href: "/patient/prevention#health-check" },
  vaccines: { id: "vaccines", href: "/patient/prevention" },
  family: { id: "family", href: "/patient/supporting" },
  explore: { id: "explore", href: "/patient/learn" },
};

const REAL_CONDITIONS: readonly ConditionCode[] = ["hypertension", "diabetes", "asthma", "kidney", "heart", "other"];

export function hasCondition(a: OnboardingAnswers): boolean {
  return a.conditions.some((c) => REAL_CONDITIONS.includes(c));
}

/**
 * Which cards lead on Home, in order, at most three. Deterministic and explainable: the same answers always give the same
 * cards. Someone who named a condition leads with readings and medicines; someone who wants to stay ahead leads with the
 * health check; someone looking after family leads with the people they support. Everything else on Home stays exactly
 * where it was, this only decides what goes first.
 */
export function focusFromAnswers(a: OnboardingAnswers): readonly FocusItem[] {
  const out: FocusItem["id"][] = [];
  const add = (id: FocusItem["id"]) => {
    if (!out.includes(id)) out.push(id);
  };
  const manage = a.goals.includes("manage_condition") || hasCondition(a);
  if (manage) {
    add("log_readings");
    if (a.conditions.some((c) => c === "hypertension" || c === "diabetes" || c === "heart" || c === "kidney" || c === "asthma")) add("medicines");
  }
  if (a.goals.includes("stay_ahead") || a.goals.includes("screening_check")) add("health_check");
  if (a.goals.includes("stay_ahead")) add("vaccines");
  if (a.goals.includes("family_care")) add("family");
  if (out.length === 0) add("explore");
  return out.slice(0, 3).map((id) => FOCUS_BY_ID[id]);
}

/** Plan preview steps (spec 1.11): the order of the first moves, built from the answers alone. */
export type PlanStepId = "start_readings" | "meet_care_team" | "health_check" | "vaccines" | "family" | "look_around";

export function planStepsFromAnswers(a: OnboardingAnswers): readonly PlanStepId[] {
  const steps: PlanStepId[] = [];
  const manage = a.goals.includes("manage_condition") || hasCondition(a);
  if (manage) steps.push("start_readings", "meet_care_team");
  if (a.goals.includes("stay_ahead") || a.goals.includes("screening_check")) steps.push("health_check");
  if (a.goals.includes("stay_ahead")) steps.push("vaccines");
  if (a.goals.includes("family_care")) steps.push("family");
  if (steps.length === 0) steps.push("look_around");
  return [...new Set(steps)].slice(0, 4);
}

/** Reads rows from `onboarding_answers` back into answers. Anything unrecognised is dropped, never trusted. */
export function answersFromRows(rows: readonly { question_code: string; answer: unknown }[] | null | undefined): OnboardingAnswers | null {
  if (!rows) return null;
  const pick = (code: string): string[] => {
    const row = rows.find((r) => r.question_code === code);
    return Array.isArray(row?.answer) ? row.answer.filter((x): x is string => typeof x === "string") : [];
  };
  const v = validateOnboardingAnswers(pick("goals"), pick("conditions"));
  return v.ok ? v.value : null;
}
