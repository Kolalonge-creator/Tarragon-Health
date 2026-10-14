// P6: the event bus handler for the two triggers that are not a reading: silence (BP-A5) and adherence (BP-A4).
//
// Same rules as the observation handler: the SAME pure engine the phone runs (INV-01, no model call), every outside call
// injected so it tests without a database, safe to run twice (record_coverage_triage_result is idempotent per patient,
// trigger and Lagos day). The daily sweep decides WHO is looked at; the engine decides WHAT the grade is. A patient who is
// not an active Member with a blood pressure interest has no context, so a Free patient never reaches a doctor's queue.

import { grade } from "../clinical/engine.ts";
import type { RuleSet, TriageInput, TriageResult } from "../clinical/types.ts";
import { PermanentHandlerError, type BusEvent, type Handler, type HandlerContext } from "../event-bus/dispatch.ts";
import { BP_RULE_SET_CODE, withKnownAge, type RuleSetForGrading } from "./observation-handler.ts";

export const COVERAGE_HANDLER_KEY = "triage.grade_coverage";

export type CoverageTrigger = "silence" | "adherence";

const TRIGGER_OF_EVENT: Readonly<Record<string, CoverageTrigger>> = {
  "silence.detected": "silence",
  "adherence.below_line": "adherence",
};

export interface CoverageContext {
  found: boolean;
  input?: TriageInput;
}

export interface CoveragePorts {
  loadContext(patientId: string, trigger: CoverageTrigger, day: string): Promise<CoverageContext>;
  loadRuleSet(code: string): Promise<RuleSetForGrading | null>;
  record(args: {
    patientId: string;
    trigger: CoverageTrigger;
    day: string;
    result: TriageResult;
    ruleSetId: string;
    causationId: string;
    /** What the engine was given (INV-16): stored so a clinician can see why a task exists. */
    context: unknown;
  }): Promise<void>;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function makeCoverageHandler(ports: CoveragePorts): Handler {
  return async (event: BusEvent, _ctx: HandlerContext): Promise<void> => {
    const trigger = TRIGGER_OF_EVENT[event.eventType];
    if (!trigger) throw new PermanentHandlerError(`${event.eventType} is not a coverage trigger`);
    if (!event.patientId) throw new PermanentHandlerError(`${event.eventType} has no patient`);
    const day = event.payload["day"];
    if (typeof day !== "string" || !DAY.test(day)) throw new PermanentHandlerError(`${event.eventType} payload has no day`);

    const context = await ports.loadContext(event.patientId, trigger, day);
    // Not an active Member with a blood pressure interest any more (lapsed since the sweep, or no doses due): nothing to grade.
    if (!context.found || !context.input) return;

    const set = await ports.loadRuleSet(BP_RULE_SET_CODE);
    if (!set) throw new Error(`no ${BP_RULE_SET_CODE} rule set to grade with`);

    const result = grade(withKnownAge(context.input), set.rules as RuleSet);
    if (result.status === "rejected" && result.reason === "invalid_rule_set") throw new Error(`rule set ${set.id} is not valid`);
    // A rejected input is not a grade and creates nothing; the next day's sweep looks again.
    if (result.status !== "graded") return;

    await ports.record({
      patientId: event.patientId,
      trigger,
      day,
      result,
      ruleSetId: set.id,
      causationId: event.eventId,
      context: context.input.trigger,
    });
  };
}
