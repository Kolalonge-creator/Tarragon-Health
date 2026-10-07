import { describe, expect, it, jest } from "@jest/globals";
import { PermanentHandlerError, type BusEvent, type HandlerContext } from "../../../supabase/functions/_shared/event-bus/dispatch";
import { makeProgrammeProgressHandler, PROGRAMME_PROGRESS_HANDLER_KEY, type ProgrammeProgressPorts } from "./index";
import { programmeProgressPorts } from "../../../supabase/functions/process-events/queue-ports";
import { buildHandlers } from "../../../supabase/functions/process-events/handlers";

const ctx: HandlerContext = { once: async (_n, fn) => { await fn(); return true; } };
const event = (payload: Record<string, unknown>): BusEvent => ({
  deliveryId: "d", leaseToken: "l", attempt: 1, eventId: "e", eventType: "programme.session_completed", eventVersion: 1, organisationId: "o", patientId: "p",
  aggregateType: "therapy_enrolment", aggregateId: "a", payload, priority: "normal", isTest: true, occurredAt: "2026-10-07T00:00:00Z",
  subscriberKey: PROGRAMME_PROGRESS_HANDLER_KEY, handlerKey: PROGRAMME_PROGRESS_HANDLER_KEY,
});

describe("programme.session_completed -> programme-progress handler", () => {
  it("asks the database to run the progress check for the enrolment in the payload", async () => {
    const runProgress = jest.fn<ProgrammeProgressPorts["runProgress"]>().mockResolvedValue({ flagged: false, taskFailed: false });
    await makeProgrammeProgressHandler({ runProgress })(event({ enrolment_id: "e1", ordinal: 3 }), ctx);
    expect(runProgress).toHaveBeenCalledWith("e1");
  });

  it("accepts a flagged result: the database already raised the review task", async () => {
    const runProgress = jest.fn<ProgrammeProgressPorts["runProgress"]>().mockResolvedValue({ flagged: true, taskFailed: false });
    await expect(makeProgrammeProgressHandler({ runProgress })(event({ enrolment_id: "e1" }), ctx)).resolves.toBeUndefined();
  });

  it("dead-letters a payload with no enrolment id, since a retry cannot fix it", async () => {
    const runProgress = jest.fn<ProgrammeProgressPorts["runProgress"]>();
    const h = makeProgrammeProgressHandler({ runProgress });
    await expect(h(event({}), ctx)).rejects.toBeInstanceOf(PermanentHandlerError);
    await expect(h(event({ enrolment_id: "" }), ctx)).rejects.toBeInstanceOf(PermanentHandlerError);
    expect(runProgress).not.toHaveBeenCalled();
  });

  it("lets a database failure through so the delivery retries: a worsening score is never dropped quietly", async () => {
    const runProgress = jest.fn<ProgrammeProgressPorts["runProgress"]>().mockRejectedValue(new Error("db down"));
    await expect(makeProgrammeProgressHandler({ runProgress })(event({ enrolment_id: "e1" }), ctx)).rejects.toThrow("db down");
  });

  it("fails the delivery when the review task could not be created, so it retries and then dead-letters visibly", async () => {
    const runProgress = jest.fn<ProgrammeProgressPorts["runProgress"]>().mockResolvedValue({ flagged: true, taskFailed: true });
    await expect(makeProgrammeProgressHandler({ runProgress })(event({ enrolment_id: "e1" }), ctx)).rejects.toThrow(/review task/);
  });

  it("the real port calls therapy_run_progress and reads the flags", async () => {
    const rpc = jest.fn<(n: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>>();
    rpc.mockResolvedValueOnce({ data: { flagged: true, task_failed: false }, error: null });
    expect(await programmeProgressPorts({ rpc }).runProgress("e1")).toEqual({ flagged: true, taskFailed: false });
    expect(rpc).toHaveBeenCalledWith("therapy_run_progress", { p_enrolment: "e1" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "nope" } });
    await expect(programmeProgressPorts({ rpc }).runProgress("e1")).rejects.toThrow("therapy_run_progress: nope");
  });

  it("is registered in the process-events handler map under the subscriber's handler key", () => {
    const handlers = buildHandlers({ rpc: async () => ({ data: null, error: null }) });
    expect(typeof handlers[PROGRAMME_PROGRESS_HANDLER_KEY]).toBe("function");
  });
});
