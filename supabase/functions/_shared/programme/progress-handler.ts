// S63: `programme-progress`, the event bus handler for programme.session_completed.
//
// Thin on purpose: the database decides everything (whether a worsening threshold is crossed, the pause, the clinician review task, the
// programme.flag event), using the PROPOSED thresholds in the active therapy_programme_config row. This handler is the SECOND line: the
// same idempotent check already ran inline when the session was completed, so a missed or delayed event cannot hide a worsening, and a
// failed task creation is retried here (the task dedupes). A failure must reach the bus (retry, then dead letter): a worsening score that
// cannot be assessed must never be dropped quietly.
//
// The payload carries ids only (INV-07 style): the scores are read by the database, never from the event.

import { PermanentHandlerError, type BusEvent, type Handler, type HandlerContext } from "../event-bus/dispatch.ts";

export const PROGRAMME_PROGRESS_HANDLER_KEY = "programme.assess_progress";

export interface ProgrammeProgressPorts {
  /** Calls public.therapy_run_progress. Returns whether the enrolment is (now) flagged for clinician review. */
  runProgress(enrolmentId: string): Promise<{ flagged: boolean; taskFailed: boolean }>;
}

export function makeProgrammeProgressHandler(ports: ProgrammeProgressPorts): Handler {
  return async (event: BusEvent, _ctx: HandlerContext): Promise<void> => {
    const id = event.payload["enrolment_id"];
    if (typeof id !== "string" || id.length === 0) {
      throw new PermanentHandlerError("programme.session_completed payload has no enrolment_id");
    }
    const result = await ports.runProgress(id);
    // The review task could not be created: fail the delivery so the bus retries it, then dead-letters it where it is visible.
    if (result.taskFailed) throw new Error("the programme review task could not be created");
  };
}
