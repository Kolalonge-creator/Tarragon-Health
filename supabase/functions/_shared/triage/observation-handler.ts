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
import { GLUCOSE_RULE_SET_CODE, gradeGlucose, type GlucoseInput, type GlucoseRuleSet } from "../clinical/glucose-engine.ts";
import type { RuleSet, TriageInput, TriageResult } from "../clinical/types.ts";
import { PermanentHandlerError, type BusEvent, type Handler, type HandlerContext } from "../event-bus/dispatch.ts";

export const TRIAGE_HANDLER_KEY = "triage.grade_observation";
export const BP_RULE_SET_CODE = "bp_care_triage";

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

export interface TriagePorts {
  loadContext(observationId: string, recheck: "timed_out" | null): Promise<TriageContext>;
  loadRuleSet(code: string): Promise<RuleSetForGrading | null>;
  record(args: { observationId: string; result: TriageResult; ruleSetId: string; causationId: string; basis: string }): Promise<void>;
  /** Glucose twins of the three ports above. Blood pressure stays on the ports above, untouched. */
  loadGlucoseContext(observationId: string): Promise<GlucoseTriageContext>;
  loadGlucoseRuleSet(code: string): Promise<GlucoseRuleSetForGrading | null>;
  recordGlucose(args: { observationId: string; result: TriageResult; ruleSetId: string; causationId: string; basis: string }): Promise<void>;
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
  const set = await ports.loadGlucoseRuleSet(GLUCOSE_RULE_SET_CODE);
  if (!set) throw new Error(`no ${GLUCOSE_RULE_SET_CODE} rule set to grade with`);
  const result = gradeGlucose(context.input, set.rules);
  // Same stance as blood pressure: an invalid rule set is not graded half way. It retries, then dead-letters where event_bus_health()
  // shows it, while the older glucose pipeline keeps covering the patient.
  if (result.status === "rejected" && result.reason === "invalid_rule_set") {
    throw new Error(`rule set ${set.id} is not valid`);
  }
  await ports.recordGlucose({ observationId, result, ruleSetId: set.id, causationId: event.eventId, basis: context.basis ?? "" });
}

export function makeObservationHandler(ports: TriagePorts): Handler {
  return async (event: BusEvent, _ctx: HandlerContext): Promise<void> => {
    const observationId = observationIdOf(event);
    if (event.payload["kind"] === "glucose") return handleGlucose(ports, observationId, event);
    const recheck = event.payload["recheck"] === "timed_out" ? "timed_out" : null;

    const context = await ports.loadContext(observationId, recheck);
    // A reading that no longer exists, or is not a blood pressure reading, has nothing to grade.
    if (!context.found || !context.input) return;

    const set = await ports.loadRuleSet(BP_RULE_SET_CODE);
    if (!set) throw new Error(`no ${BP_RULE_SET_CODE} rule set to grade with`);

    const result = grade(context.input, set.rules);
    // A rule set the engine refuses is not graded half way. Throwing retries, then dead-letters,
    // where event_bus_health() shows it; the live pipeline keeps covering the patient meanwhile.
    if (result.status === "rejected" && result.reason === "invalid_rule_set") {
      throw new Error(`rule set ${set.id} is not valid`);
    }

    await ports.record({ observationId, result, ruleSetId: set.id, causationId: event.eventId, basis: context.basis ?? "" });
  };
}
