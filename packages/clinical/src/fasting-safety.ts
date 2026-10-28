/**
 * fasting-safety (S50b, spec 6.13, acceptance: an insulin user cannot start a fasting plan without clinician guidance).
 *
 * A religious-fasting SAFETY gate for Ramadan and Lent only. It is NOT an intermittent-fasting feature (spec Part C): there is no timer, no fasting
 * programme, and nothing here ever tells a person to fast or to break a fast. It answers one question: may this person start a fasting plan, and if
 * not, why not in a form the screen may show.
 *
 * PURE and deterministic (INV-01): no language model, no clock read, no I/O. Every outcome, medicine name and condition match lives in the versioned
 * fasting safety config (PROPOSED, unsigned; registry key `fasting.safety_rules`), so nothing here is a hard-coded threshold.
 *
 * The database function `private.fasting_gate_for(...)` is the enforcing twin; this file is its executable specification and
 * `fasting-safety-parity.test.ts` pins the shared case ids to the SQL proof so the two cannot drift silently.
 *
 * Output direction is always the safe one: any doubt (no config, a bad clock, a withheld pregnancy answer, an unknown date of birth) refuses.
 * A medicine-class block is cleared ONLY by a clinician-signed, patient-confirmed medicine timing plan (an S24 care_plan_changes row, INV-02) that
 * is applied to the medicine the person takes now and covers the whole fast. The platform proposes; it never applies or advises a timing itself.
 */

export type Fast = "ramadan" | "lent";
export type FastingDecision = "may_fast_with_guidance" | "needs_clinician_plan" | "not_advised";
export type FastingOutcome = "not_advised" | "needs_clinician_plan";

export type FastingBlock =
  | "recent_red_event"
  | "pregnancy"
  | "under_age"
  | "type1_diabetes"
  | "kidney_disease"
  | "eating_disorder"
  | "recent_amber_event"
  | "insulin"
  | "sulfonylurea"
  | "diabetes_medicines_unconfirmed"
  /** Not a rule: the gate could not be answered at all. Never returned together with another block. */
  | "rules_unavailable";

/** Priority order: the first active block is the reason. Mirrors v_order in private.fasting_gate_for. */
export const FASTING_BLOCK_ORDER: readonly FastingBlock[] = [
  "recent_red_event",
  "pregnancy",
  "under_age",
  "type1_diabetes",
  "kidney_disease",
  "eating_disorder",
  "recent_amber_event",
  "insulin",
  "sulfonylurea",
  "diabetes_medicines_unconfirmed",
];

export interface FastingMatchConfig {
  readonly name_patterns: readonly string[];
  readonly icd10_prefixes: readonly string[];
}

export interface FastingSafetyConfig {
  readonly lookback: { readonly red_hours: number; readonly amber_hours: number };
  readonly min_age_years: number;
  readonly outcomes: Readonly<Record<Exclude<FastingBlock, "rules_unavailable">, FastingOutcome>>;
  readonly matches: {
    readonly type1_diabetes: FastingMatchConfig;
    readonly kidney_disease: FastingMatchConfig;
    readonly eating_disorder: FastingMatchConfig;
    readonly diabetes: FastingMatchConfig;
  };
  readonly medicine_classes: {
    readonly insulin: { readonly name_patterns: readonly string[] };
    readonly sulfonylurea: { readonly name_patterns: readonly string[] };
    /** Diabetes medicines that carry no fasting block of their own. A recorded one only proves the medicine list is known. */
    readonly other_diabetes: { readonly name_patterns: readonly string[] };
  };
}

export interface FastingCalendarWindow {
  readonly year: number;
  readonly start: string;
  readonly end: string;
}
export type FastingCalendarConfig = Readonly<Record<Fast, readonly FastingCalendarWindow[]>>;

export interface FastingTriageEvent {
  readonly grade: "green" | "amber" | "red";
  /** ISO timestamp. */
  readonly at: string;
}

export interface FastingConditionRecord {
  readonly name: string;
  readonly icd10: string | null;
  readonly status: string;
}

export interface FastingMedicine {
  readonly id: string;
  readonly name: string;
  /** The prescription the active medicine row came from; null for a medicine the person entered themselves. */
  readonly prescriptionId: string | null;
}

/** A confirmed, clinician-signed S24 medicine change carrying a "fasting" block. */
export interface FastingTimingPlan {
  readonly changeId: string;
  readonly fast: Fast;
  /** YYYY-MM-DD */
  readonly validFrom: string;
  readonly validTo: string;
  readonly appliedPrescriptionId: string | null;
}

export interface FastingGateInput {
  /** ISO timestamp the caller supplies, so the function stays pure. */
  readonly now: string;
  readonly fast: Fast;
  /** YYYY-MM-DD the person plans to start; defaults to today in Lagos. */
  readonly startsOn?: string | null;
  readonly endsOn?: string | null;
  /** YYYY-MM-DD; null (unknown) fails closed as under age. */
  readonly dateOfBirth: string | null;
  readonly events: readonly FastingTriageEvent[];
  readonly conditions: readonly FastingConditionRecord[];
  readonly medicines: readonly FastingMedicine[];
  readonly timingPlans: readonly FastingTimingPlan[];
  /** Pregnant or in the postpartum year. null = the reader is not entitled to this (withheld), which answers "unavailable". */
  readonly pregnancyOrPostpartum: boolean | null;
  /** obesity_ed_screens.positive for the person (derived by a trigger from two or more SCOFF answers). */
  readonly eatingDisorderScreenPositive: boolean;
  /** A clinician's open nutrition hold (the hold that withholds calorie targets). Treated like an eating-disorder concern; the person is never told which. */
  readonly nutritionHold: boolean;
}

export interface FastingGateResult {
  readonly decision: FastingDecision;
  /** The first (highest priority) active block, or "none". */
  readonly reason: FastingBlock | "none";
  readonly blocks: readonly FastingBlock[];
  /** Medicine classes cleared by a signed timing plan. */
  readonly covered: readonly ("insulin" | "sulfonylurea")[];
  /** The timing plans that cleared them. */
  readonly timingChangeIds: readonly string[];
}

const HOUR_MS = 3_600_000;
const LAGOS_OFFSET_MS = HOUR_MS; // Africa/Lagos is UTC+1 all year.
const INACTIVE_STATUSES: readonly string[] = ["resolved", "historical"];

const UNAVAILABLE: FastingGateResult = {
  decision: "not_advised",
  reason: "rules_unavailable",
  blocks: ["rules_unavailable"],
  covered: [],
  timingChangeIds: [],
};

/** The Lagos calendar date (YYYY-MM-DD) of an ISO timestamp, or null when it is not a time. */
export function lagosDate(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

/** The date `years` before `date`, clamping 29 February to 28 (what Postgres date - interval does). */
export function yearsBefore(date: string, years: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const ty = y - years;
  const leap = (ty % 4 === 0 && ty % 100 !== 0) || ty % 400 === 0;
  const day = m === 2 && d === 29 && !leap ? 28 : d;
  return `${String(ty).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function matches(records: readonly FastingConditionRecord[], match: FastingMatchConfig): boolean {
  return records.some((r) => {
    if (INACTIVE_STATUSES.includes(r.status)) return false;
    const name = r.name.toLowerCase();
    const code = (r.icd10 ?? "").toUpperCase();
    return (
      match.name_patterns.some((p) => p !== "" && name.includes(p.toLowerCase())) ||
      (code !== "" && match.icd10_prefixes.some((p) => code.startsWith(p.toUpperCase())))
    );
  });
}

function eventWithin(events: readonly FastingTriageEvent[], grade: "amber" | "red", windowHours: number, nowMs: number): boolean {
  return events.some((e) => {
    if (e.grade !== grade) return false;
    const age = nowMs - Date.parse(e.at);
    return age >= 0 && age <= windowHours * HOUR_MS;
  });
}

function nameMatches(drug: string, patterns: readonly string[]): boolean {
  const lower = drug.toLowerCase();
  return patterns.some((p) => p !== "" && lower.includes(p.toLowerCase()));
}

export function fastingGate(input: FastingGateInput, config: FastingSafetyConfig | null): FastingGateResult {
  if (config === null) return UNAVAILABLE;
  const nowMs = Date.parse(input.now);
  const today = lagosDate(input.now);
  // A withheld pregnancy answer is "unavailable", never a guess in either direction.
  if (today === null || input.pregnancyOrPostpartum === null) return UNAVAILABLE;

  const starts = input.startsOn ?? today;
  const ends = input.endsOn ?? starts;
  const active = new Set<FastingBlock>();

  if (eventWithin(input.events, "red", config.lookback.red_hours, nowMs)) active.add("recent_red_event");
  if (eventWithin(input.events, "amber", config.lookback.amber_hours, nowMs)) active.add("recent_amber_event");
  if (input.pregnancyOrPostpartum) active.add("pregnancy");
  if (input.dateOfBirth === null || input.dateOfBirth > yearsBefore(today, config.min_age_years)) active.add("under_age");
  if (matches(input.conditions, config.matches.type1_diabetes)) active.add("type1_diabetes");
  if (matches(input.conditions, config.matches.kidney_disease)) active.add("kidney_disease");
  if (input.eatingDisorderScreenPositive || input.nutritionHold || matches(input.conditions, config.matches.eating_disorder)) active.add("eating_disorder");

  const covered: ("insulin" | "sulfonylurea")[] = [];
  const timingChangeIds: string[] = [];
  for (const cls of ["insulin", "sulfonylurea"] as const) {
    const meds = input.medicines.filter((m) => nameMatches(m.name, config.medicine_classes[cls].name_patterns));
    let uncovered = false;
    let anyCovered = false;
    for (const med of meds) {
      const plan = input.timingPlans.find(
        (p) =>
          p.fast === input.fast &&
          p.appliedPrescriptionId !== null &&
          p.appliedPrescriptionId === med.prescriptionId &&
          p.validFrom <= starts &&
          p.validTo >= ends &&
          p.validTo >= today,
      );
      if (plan === undefined) uncovered = true;
      else {
        anyCovered = true;
        timingChangeIds.push(plan.changeId);
      }
    }
    if (uncovered) active.add(cls);
    else if (anyCovered) covered.push(cls);
  }
  // A diabetes diagnosis with no recognised diabetes medicine recorded cannot be told apart from an unrecorded insulin or sulfonylurea, so it needs a clinician.
  // An unrelated medicine (a blood pressure tablet, say) proves nothing about the diabetes list.
  const knownDiabetesMedicine = input.medicines.some(
    (m) => nameMatches(m.name, config.medicine_classes.insulin.name_patterns) || nameMatches(m.name, config.medicine_classes.sulfonylurea.name_patterns) || nameMatches(m.name, config.medicine_classes.other_diabetes.name_patterns),
  );
  if (!knownDiabetesMedicine && matches(input.conditions, config.matches.diabetes)) active.add("diabetes_medicines_unconfirmed");

  const blocks = FASTING_BLOCK_ORDER.filter((b) => active.has(b));
  const hard = blocks.some((b) => config.outcomes[b as Exclude<FastingBlock, "rules_unavailable">] === "not_advised");
  const decision: FastingDecision = hard ? "not_advised" : blocks.length > 0 ? "needs_clinician_plan" : "may_fast_with_guidance";
  return { decision, reason: blocks[0] ?? "none", blocks, covered, timingChangeIds };
}

// ---------------------------------------------------------------------------
// The public answer: what a screen may be told. Mirrors public.my_fasting_gate.
// ---------------------------------------------------------------------------

/** Reasons that must never reach a screen by name. Any one of them (or "could not be answered") collapses to the single unavailable answer. */
const SENSITIVE: readonly FastingBlock[] = ["pregnancy", "under_age", "type1_diabetes", "kidney_disease", "eating_disorder", "rules_unavailable"];

export type PublicFastingBlock = "recent_red_event" | "recent_amber_event" | "medicine_timing_plan_needed";
export type PublicFastingReason = PublicFastingBlock | "none";

export type PublicFastingAnswer =
  | { readonly state: "unavailable" }
  | {
      readonly state: "ok";
      readonly decision: FastingDecision;
      readonly reason: PublicFastingReason;
      readonly blocks: readonly PublicFastingBlock[];
      readonly hasTimingPlan: boolean;
    };

export const UNAVAILABLE_FASTING_ANSWER: PublicFastingAnswer = { state: "unavailable" };

function publicBlock(b: FastingBlock): PublicFastingBlock {
  return b === "insulin" || b === "sulfonylurea" || b === "diabetes_medicines_unconfirmed" ? "medicine_timing_plan_needed" : (b as PublicFastingBlock);
}

export function publicFastingAnswer(result: FastingGateResult): PublicFastingAnswer {
  if (result.blocks.some((b) => SENSITIVE.includes(b))) return UNAVAILABLE_FASTING_ANSWER;
  const blocks = [...new Set(result.blocks.map(publicBlock))];
  return {
    state: "ok",
    decision: result.decision,
    reason: blocks[0] ?? "none",
    blocks,
    hasTimingPlan: result.covered.length > 0,
  };
}

const DECISIONS: readonly string[] = ["may_fast_with_guidance", "needs_clinician_plan", "not_advised"];
const PUBLIC_BLOCKS: readonly string[] = ["recent_red_event", "recent_amber_event", "medicine_timing_plan_needed"];

/**
 * Reads the JSON that `public.my_fasting_gate()` returns. Anything that is not exactly that shape (an unknown word, a "may fast" that still carries a
 * block, a reason that does not match the blocks) is the unavailable answer: a client that cannot read the reply must not guess a permissive one.
 */
export function parseFastingAnswer(json: unknown): PublicFastingAnswer {
  if (typeof json !== "object" || json === null) return UNAVAILABLE_FASTING_ANSWER;
  const o = json as Record<string, unknown>;
  if (o.state !== "ok") return UNAVAILABLE_FASTING_ANSWER;
  const { decision, reason, blocks, has_timing_plan: plan } = o;
  if (typeof decision !== "string" || !DECISIONS.includes(decision)) return UNAVAILABLE_FASTING_ANSWER;
  if (!Array.isArray(blocks) || !blocks.every((b) => typeof b === "string" && PUBLIC_BLOCKS.includes(b))) return UNAVAILABLE_FASTING_ANSWER;
  if ((decision === "may_fast_with_guidance") !== (blocks.length === 0)) return UNAVAILABLE_FASTING_ANSWER;
  if (reason !== (blocks[0] ?? "none")) return UNAVAILABLE_FASTING_ANSWER;
  return {
    state: "ok",
    decision: decision as FastingDecision,
    reason: reason as PublicFastingReason,
    blocks: blocks as PublicFastingBlock[],
    hasTimingPlan: plan === true,
  };
}

/** The i18n key for the main line on the fasting screen. Wording never names a reading, a condition, a pregnancy or an age. */
export function fastingMessageKey(answer: PublicFastingAnswer): "fasting.answer.unavailable" | "fasting.answer.may" | "fasting.answer.needs_plan" | "fasting.answer.paused" {
  if (answer.state === "unavailable") return "fasting.answer.unavailable";
  if (answer.decision === "may_fast_with_guidance") return "fasting.answer.may";
  return answer.decision === "needs_clinician_plan" ? "fasting.answer.needs_plan" : "fasting.answer.paused";
}

/** Whether the screen may offer the "start my fast" action. Only the one permissive answer does. */
export function mayStartFast(answer: PublicFastingAnswer): boolean {
  return answer.state === "ok" && answer.decision === "may_fast_with_guidance";
}

/** The expected window for a fast on or after `today`, or null ("unknown until a person confirms locally"). */
export function expectedFastWindow(calendar: FastingCalendarConfig | null, fast: Fast, today: string): FastingCalendarWindow | null {
  const windows = calendar?.[fast] ?? [];
  const upcoming = windows.filter((w) => w.end >= today).sort((a, b) => (a.start < b.start ? -1 : 1));
  return upcoming[0] ?? null;
}
