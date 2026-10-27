// S12: the event bus handler that grades a blood pressure observation (spec Section 5, 6).
//
// It runs the SAME pure engine the phone runs (supabase/functions/_shared/clinical), with every
// outside call injected so it can be tested without a database. It never calls a language model
// (INV-01). It is safe to run twice: record_triage_result is idempotent per reading and rule set.
//
// Until the Chief Medical Officer approves a rule set the server grades with the draft and the result
// is recorded as shadow (OQ-88); this file does not decide that, the database does, from the status
// of the rule set row it is told it used.

import { grade } from "../clinical/engine.ts";
import { applyBpOverride, applyGlucoseOverride, type ActiveOverride, type OverrideDomain } from "../clinical/threshold-override.ts";
import { GLUCOSE_RULE_SET_CODE, gradeGlucose, type GlucoseInput, type GlucoseRuleSet } from "../clinical/glucose-engine.ts";
import { gradeVitals, VITALS_RULE_SET_CODE, type VitalsInput, type VitalsRuleSet } from "../clinical/vitals-engine.ts";
import type { RuleSet, TriageInput, TriageResult } from "../clinical/types.ts";
import { PermanentHandlerError, type BusEvent, type Handler, type HandlerContext } from "../event-bus/dispatch.ts";

export const TRIAGE_HANDLER_KEY = "triage.grade_observation";
export const BP_RULE_SET_CODE = "bp_care_triage";
/** Observation kinds that are recorded but never graded (S47a). */
export const NON_TRIAGE_KINDS: readonly string[] = ["water", "sleep", "mood"];

export interface TriageContext {
  found: boolean;
  isTest?: boolean;
  /** What the grade is based on (symptoms and recheck state seen); a regrade with new facts is a new result. */
  basis?: string;
  input?: TriageInput;
}

export interface RuleSetForGrading {
  id: string;
  status: "draft" | "approved";
  rules: RuleSet;
}

/** What the database says about a glucose reading (plan item R2). Same shape idea as TriageContext, with the glucose engine's input. */
export interface GlucoseTriageContext {
  found: boolean;
  isTest?: boolean;
  basis?: string;
  input?: GlucoseInput;
}

export interface GlucoseRuleSetForGrading {
  id: string;
  status: "draft" | "approved";
  rules: GlucoseRuleSet;
}

/** What the database says about a pulse, SpO2 or temperature reading. Same shape idea as the glucose context, with the vitals engine's input. */
export interface VitalsTriageContext {
  found: boolean;
  isTest?: boolean;
  basis?: string;
  input?: VitalsInput;
}

export interface VitalsRuleSetForGrading {
  id: string;
  status: "draft" | "approved";
  rules: VitalsRuleSet;
}

export interface TriagePorts {
  loadContext(observationId: string, recheck: "timed_out" | null): Promise<TriageContext>;
  loadRuleSet(code: string): Promise<RuleSetForGrading | null>;
  record(args: { observationId: string; result: TriageResult; ruleSetId: string; causationId: string; basis: string }): Promise<void>;
  /** Glucose twins of the three ports above. Blood pressure stays on the ports above, untouched. */
  loadGlucoseContext(observationId: string): Promise<GlucoseTriageContext>;
  loadGlucoseRuleSet(code: string): Promise<GlucoseRuleSetForGrading | null>;
  recordGlucose(args: { observationId: string; result: TriageResult; ruleSetId: string; causationId: string; basis: string }): Promise<void>;
  /** Vitals (pulse, SpO2, temperature) twins of the same three ports. */
  loadVitalsContext(observationId: string): Promise<VitalsTriageContext>;
  loadVitalsRuleSet(code: string): Promise<VitalsRuleSetForGrading | null>;
  recordVitals(args: { observationId: string; result: TriageResult; ruleSetId: string; causationId: string; basis: string }): Promise<void>;
  /**
   * Personal threshold overrides (optional: a port set without them grades exactly as before). Returns the patient's signed, in-date
   * override for this domain, or null. A load that fails is treated as "no override" (the signed default stands, which can only be
   * as urgent or more urgent), never as a reason to stop grading.
   */
  loadThresholdOverride?(observationId: string, domain: OverrideDomain): Promise<ActiveOverride | null>;
  /** Stores which override changed this grade next to the triage event. Idempotent. Called only when an override changed the grade. */
  recordOverrideApplication?(args: { observationId: string; domain: OverrideDomain; result: TriageResult; ruleSetId: string; basis: string }): Promise<void>;
}

/** An older database without the override functions yet (the migration lands after this code): no override, not an error. */
const OVERRIDE_NOT_INSTALLED = /could not find the function|does not exist|PGRST202/i;
/**
 * How many delivery attempts a failed override load is retried before the signed default is used. A lost override can be a silent downgrade (a personal red low
 * line would be graded at the amber default), so a failed load is retried through the bus first (dead letters and retries show in event_bus_health), and the
 * fallback is logged loudly rather than quiet.
 */
export const OVERRIDE_LOAD_ATTEMPTS = 3;

async function overrideFor(ports: TriagePorts, observationId: string, domain: OverrideDomain, attempt: number): Promise<ActiveOverride | null> {
  if (!ports.loadThresholdOverride) return null;
  try {
    return await ports.loadThresholdOverride(observationId, domain);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (OVERRIDE_NOT_INSTALLED.test(message)) return null;
    if (attempt < OVERRIDE_LOAD_ATTEMPTS) throw e;
    console.error(JSON.stringify({ fn: "process-events", message: "personal threshold load failed; graded at the signed default", domain, error: message }));
    return null;
  }
}

/** The override layer is a refinement: a fault inside it must never stop the signed grade being recorded. */
function applySafely(apply: () => TriageResult, fallback: TriageResult, domain: OverrideDomain): TriageResult {
  try {
    return apply();
  } catch (e) {
    console.error(JSON.stringify({ fn: "process-events", message: "personal threshold could not be applied; graded at the signed default", domain, error: e instanceof Error ? e.message : String(e) }));
    return fallback;
  }
}

async function recordApplication(ports: TriagePorts, observationId: string, domain: OverrideDomain, result: TriageResult, ruleSetId: string, basis: string): Promise<void> {
  if (result.override && ports.recordOverrideApplication) {
    await ports.recordOverrideApplication({ observationId, domain, result, ruleSetId, basis });
  }
}

/**
 * The database drops a null from the JSON it sends (jsonb_strip_nulls), so a patient with no date of birth arrives with no
 * `ageYears` at all, and the engine's input check wants the key (`null` means unknown). Without this such a patient's reading
 * (or silence) was rejected as invalid_input and never graded. Unknown age stays unknown; nothing is invented.
 */
export function withKnownAge(input: TriageInput): TriageInput {
  return input.ageYears === undefined ? { ...input, ageYears: null } : input;
}

/**
 * The glucose twin of withKnownAge. The glucose context is built with jsonb_strip_nulls too, so a patient with no date of birth
 * (or no diabetes record) arrives with the key missing. The glucose engine already treats absent as "not recorded"; this makes the
 * handler hand it the explicit null as well, so the two engines cannot drift on this again. Unknown stays unknown.
 */
export function withKnownGlucoseFields(input: GlucoseInput): GlucoseInput {
  return input.ageYears === undefined || input.diabetesType === undefined
    ? { ...input, ageYears: input.ageYears ?? null, diabetesType: input.diabetesType ?? null }
    : input;
}

/**
 * The vitals twin of withKnownGlucoseFields. The vitals context is built with jsonb_strip_nulls, so a patient with no date of birth (or no personal
 * line) arrives with the keys missing; the engine reads absent as "not recorded", and this hands it the explicit null as well. Unknown stays unknown.
 */
export function withKnownVitalsFields(input: VitalsInput): VitalsInput {
  return input.ageYears === undefined || input.personalAmberLine === undefined
    ? { ...input, ageYears: input.ageYears ?? null, personalAmberLine: input.personalAmberLine ?? null }
    : input;
}

function observationIdOf(event: BusEvent): string {
  const id = event.payload["observation_id"];
  if (typeof id !== "string" || id.length === 0) {
    throw new PermanentHandlerError("observation.recorded payload has no observation_id");
  }
  return id;
}

async function handleGlucose(ports: TriagePorts, observationId: string, event: BusEvent): Promise<void> {
  const context = await ports.loadGlucoseContext(observationId);
  // A reading that no longer exists, or is not a glucose reading, has nothing to grade.
  if (!context.found || !context.input) return;
  // The override lookup runs beside the rule set read, so a patient with no override costs no extra time.
  const [set, override] = await Promise.all([ports.loadGlucoseRuleSet(GLUCOSE_RULE_SET_CODE), overrideFor(ports, observationId, "glucose", event.attempt)]);
  if (!set) throw new Error(`no ${GLUCOSE_RULE_SET_CODE} rule set to grade with`);
  const glucoseInput = withKnownGlucoseFields(context.input);
  const defaultResult = gradeGlucose(glucoseInput, set.rules);
  const result = applySafely(() => applyGlucoseOverride(glucoseInput, defaultResult, set.rules, override).result, defaultResult, "glucose");
  // Same stance as blood pressure: an invalid rule set is not graded half way. It retries, then dead-letters where event_bus_health()
  // shows it, while the older glucose pipeline keeps covering the patient.
  if (result.status === "rejected" && result.reason === "invalid_rule_set") {
    throw new Error(`rule set ${set.id} is not valid`);
  }
  const basis = context.basis ?? "";
  await ports.recordGlucose({ observationId, result, ruleSetId: set.id, causationId: event.eventId, basis });
  await recordApplication(ports, observationId, "glucose", result, set.id, basis);
}

async function handleVitals(ports: TriagePorts, observationId: string, event: BusEvent): Promise<void> {
  const context = await ports.loadVitalsContext(observationId);
  // A reading that no longer exists, or is not a pulse, SpO2 or temperature reading, has nothing to grade.
  if (!context.found || !context.input) return;
  const set = await ports.loadVitalsRuleSet(VITALS_RULE_SET_CODE);
  if (!set) throw new Error(`no ${VITALS_RULE_SET_CODE} rule set to grade with`);
  const result = gradeVitals(withKnownVitalsFields(context.input), set.rules);
  // Same stance as blood pressure and glucose: an invalid rule set is not graded half way. It retries, then dead-letters where
  // event_bus_health() shows it, while the older per-vital alerts keep covering the patient.
  if (result.status === "rejected" && result.reason === "invalid_rule_set") {
    throw new Error(`rule set ${set.id} is not valid`);
  }
  await ports.recordVitals({ observationId, result, ruleSetId: set.id, causationId: event.eventId, basis: context.basis ?? "" });
}

export function makeObservationHandler(ports: TriagePorts): Handler {
  return async (event: BusEvent, _ctx: HandlerContext): Promise<void> => {
    const observationId = observationIdOf(event);
    if (event.payload["kind"] === "glucose") return handleGlucose(ports, observationId, event);
    if (event.payload["kind"] === "vitals") return handleVitals(ports, observationId, event);
    // S47a: water, sleep and mood logs also emit observation.recorded (for the record and the summaries). They have no rule set and nothing to grade,
    // so they never reach the blood pressure path below (INV-01: no triage rule is invented for a type that has none).
    if (typeof event.payload["kind"] === "string" && NON_TRIAGE_KINDS.includes(event.payload["kind"])) return;
    const recheck = event.payload["recheck"] === "timed_out" ? "timed_out" : null;

    const context = await ports.loadContext(observationId, recheck);
    // A reading that no longer exists, or is not a blood pressure reading, has nothing to grade.
    if (!context.found || !context.input) return;

    const [set, override] = await Promise.all([ports.loadRuleSet(BP_RULE_SET_CODE), overrideFor(ports, observationId, "bp", event.attempt)]);
    if (!set) throw new Error(`no ${BP_RULE_SET_CODE} rule set to grade with`);

    const bpInput = withKnownAge(context.input);
    const defaultResult = grade(bpInput, set.rules);
    const result = applySafely(() => applyBpOverride(bpInput, defaultResult, set.rules, override).result, defaultResult, "bp");
    // A rule set the engine refuses is not graded half way. Throwing retries, then dead-letters,
    // where event_bus_health() shows it; the live pipeline keeps covering the patient meanwhile.
    if (result.status === "rejected" && result.reason === "invalid_rule_set") {
      throw new Error(`rule set ${set.id} is not valid`);
    }

    const basis = context.basis ?? "";
    await ports.record({ observationId, result, ruleSetId: set.id, causationId: event.eventId, basis });
    await recordApplication(ports, observationId, "bp", result, set.id, basis);
  };
}
