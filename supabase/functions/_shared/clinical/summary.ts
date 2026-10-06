import { actionToString } from "./actions.ts";
import type { TriageResult } from "./types.ts";

/**
 * The comparable shape of a result, used by the shared safety fixtures on the
 * server and on the device. Every key is always present so that a field an
 * expectation does not mention must still be at its default (nothing extra).
 */
export interface ResultSummary {
  status: TriageResult["status"];
  grade: TriageResult["grade"];
  ruleId: string | null;
  explanationKey: string | null;
  actions: string[];
  taskKey: string | null;
  dueMinutes: number | null;
  duplicateSuppressed: boolean;
  waitMinutes: number | null;
  reason: TriageResult["reason"];
  redFlagSymptomPresent: boolean;
}

export function summarise(result: TriageResult): ResultSummary {
  const task = result.actions.find((a) => a.kind === "create_task");
  return {
    status: result.status,
    grade: result.grade,
    ruleId: result.ruleId,
    explanationKey: result.explanationKey,
    actions: result.actions.map(actionToString),
    taskKey: result.taskKey,
    dueMinutes: task?.kind === "create_task" ? task.dueMinutes : null,
    duplicateSuppressed: result.duplicateSuppressed,
    waitMinutes: result.recheck?.waitMinutes ?? null,
    reason: result.reason,
    redFlagSymptomPresent: result.redFlagSymptomPresent,
  };
}

/** Fills the defaults into a fixture expectation so it can be compared with `summarise` exactly. */
export function expectationWithDefaults(expectation: Partial<ResultSummary>): ResultSummary {
  return {
    status: "graded",
    grade: null,
    ruleId: null,
    explanationKey: null,
    actions: [],
    taskKey: null,
    dueMinutes: null,
    duplicateSuppressed: false,
    waitMinutes: null,
    reason: null,
    redFlagSymptomPresent: false,
    ...expectation,
  };
}
