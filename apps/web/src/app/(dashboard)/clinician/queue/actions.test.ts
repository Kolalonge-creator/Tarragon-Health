const rpc = jest.fn();
const heldType = jest.fn();
const redirect = jest.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

jest.mock("next/navigation", () => ({ redirect: (p: string) => redirect(p) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(heldType()) }) }) }),
  }),
}));

import { completeTask, extendClaim, handBack, takeNextTask } from "./actions";

const id = "11111111-1111-4111-8111-111111111111";
const form = (entries: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

beforeEach(() => {
  rpc.mockReset();
  heldType.mockReset();
  heldType.mockReturnValue({ data: { type: "amber_bp_review" }, error: null });
  redirect.mockClear();
});

describe("takeNextTask", () => {
  it("asks for any eligible type and opens the claimed task", async () => {
    rpc.mockResolvedValue({ data: { already_claimed: false, task: { id, type: "amber_bp_review", priority_class: 2 } }, error: null });
    await expect(takeNextTask()).rejects.toThrow(`REDIRECT:/clinician/tasks/${id}`);
    expect(rpc).toHaveBeenCalledWith("queue_next", {});
  });

  it("goes back to the queue with a notice when nothing is waiting", async () => {
    rpc.mockResolvedValue({ data: { already_claimed: false, task: null, reason: "none_eligible" }, error: null });
    await expect(takeNextTask()).rejects.toThrow("REDIRECT:/clinician/queue?none=1");
  });

  it("explains a closed queue in words, not a code", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "queue_no_availability", code: "P0001" } });
    const result = await takeNextTask();
    expect(result?.error).toMatch(/Declare that you are available/);
  });

  it("does not guess when the answer cannot be read", async () => {
    rpc.mockResolvedValue({ data: { surprise: true }, error: null });
    const result = await takeNextTask();
    expect(result?.error).toMatch(/could not read/);
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("completeTask (S16-S20 D4: a coded outcome)", () => {
  it("refuses a missing outcome before calling the database", async () => {
    const result = await completeTask(undefined, form({ task_id: id, note: "Called the patient and agreed a recheck." }));
    expect(result?.error).toMatch(/how this task was finished/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("completes with the code and returns to the queue; a note is optional", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(completeTask(undefined, form({ task_id: id, code: "completed_no_action_needed" }))).rejects.toThrow("REDIRECT:/clinician/queue?done=1");
    expect(rpc).toHaveBeenCalledWith("queue_complete", { p_task: id, p_outcome: { code: "completed_no_action_needed" } });
  });

  it("carries the note as a note beside the code", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(completeTask(undefined, form({ task_id: id, code: "referred_on", note: "Sent to the heart clinic." }))).rejects.toThrow("REDIRECT:/clinician/queue?done=1");
    expect(rpc).toHaveBeenCalledWith("queue_complete", { p_task: id, p_outcome: { code: "referred_on", note: "Sent to the heart clinic." } });
  });

  it("refuses a code the task type does not list", async () => {
    const result = await completeTask(undefined, form({ task_id: id, code: "result_released" }));
    expect(result?.error).toMatch(/how this task was finished/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["async_question", "written_question_call", "titration_signoff", "red_event_unacknowledged", "symptom_review"])("will not close a %s task from this form", async (type) => {
    heldType.mockReturnValue({ data: { type }, error: null });
    const result = await completeTask(undefined, form({ task_id: id, code: "completed_action_taken" }));
    expect(result?.error).toMatch(/own page/);
    expect(rpc).not.toHaveBeenCalled();
  });

  describe("a critical result closed by contact attempts", () => {
    const attempt = (i: number, method = "phone_call") => ({ [`attempt_method_${i}`]: method, [`attempt_at_${i}`]: "2026-10-14T13:05" });
    const base = { task_id: id, code: "contact_attempts_documented" };

    beforeEach(() => heldType.mockReturnValue({ data: { type: "critical_result_review" }, error: null }));

    it("sends the attempts, with Lagos time turned into a precise time", async () => {
      rpc.mockResolvedValue({ data: null, error: null });
      await expect(completeTask(undefined, form({ ...base, ...attempt(0), ...attempt(1), ...attempt(2, "in_app_message") }))).rejects.toThrow("REDIRECT:/clinician/queue?done=1");
      const outcome = (rpc.mock.calls[0]?.[1] as { p_outcome: { code: string; attempts: { at: string; method: string; reached: boolean }[] } }).p_outcome;
      expect(outcome.code).toBe("contact_attempts_documented");
      expect(outcome.attempts).toHaveLength(3);
      expect(outcome.attempts[0]).toEqual({ at: "2026-10-14T12:05:00.000Z", method: "phone_call", reached: false });
    });

    it("records whether the patient was reached", async () => {
      rpc.mockResolvedValue({ data: null, error: null });
      await expect(
        completeTask(undefined, form({ ...base, ...attempt(0), ...attempt(1), ...attempt(2), attempt_reached_2: "on" })),
      ).rejects.toThrow("REDIRECT:/clinician/queue?done=1");
      const outcome = (rpc.mock.calls[0]?.[1] as { p_outcome: { attempts: { reached: boolean }[] } }).p_outcome;
      expect(outcome.attempts.map((a) => a.reached)).toEqual([false, false, true]);
    });

    it("asks for more when there are too few, or a method is not on the list, or a time is unreadable", async () => {
      for (const fields of [
        { ...base, ...attempt(0), ...attempt(1) },
        { ...base, ...attempt(0), ...attempt(1), ...attempt(2, "carrier_pigeon") },
        { ...base, ...attempt(0), ...attempt(1), attempt_method_2: "phone_call", attempt_at_2: "yesterday" },
      ]) {
        const result = await completeTask(undefined, form(fields));
        expect(result?.error).toMatch(/at least 3 contact attempts/);
      }
      expect(rpc).not.toHaveBeenCalled();
    });

    it("a result that has been released needs no attempts", async () => {
      rpc.mockResolvedValue({ data: null, error: null });
      await expect(completeTask(undefined, form({ task_id: id, code: "result_released" }))).rejects.toThrow("REDIRECT:/clinician/queue?done=1");
      expect(rpc).toHaveBeenCalledWith("queue_complete", { p_task: id, p_outcome: { code: "result_released" } });
    });

    it("tells the clinician when the record does not back the claim", async () => {
      rpc.mockResolvedValue({ data: null, error: { message: "queue_outcome_result_not_released" } });
      const result = await completeTask(undefined, form({ task_id: id, code: "result_released" }));
      expect(result?.error).toMatch(/not been released/);
    });
  });

  it("does not complete when the task type cannot be read", async () => {
    heldType.mockReturnValue({ data: null, error: { message: "boom" } });
    const result = await completeTask(undefined, form({ task_id: id, code: "completed_action_taken" }));
    expect(result?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("says so when the hold has lapsed", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "queue_claim_expired" } });
    const result = await completeTask(undefined, form({ task_id: id, code: "completed_action_taken" }));
    expect(result?.error).toMatch(/run out/);
  });
});

describe("handBack", () => {
  it("needs a reason: none is pre-selected (D7)", async () => {
    const result = await handBack(undefined, form({ task_id: id, reason: "" }));
    expect(result?.error).toMatch(/choose a reason/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("needs a note for 'other'", async () => {
    const result = await handBack(undefined, form({ task_id: id, reason: "other" }));
    expect(result?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("hands back with the reason and returns to the queue", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(handBack(undefined, form({ task_id: id, reason: "outside_competence" }))).rejects.toThrow("REDIRECT:/clinician/queue?handed_back=1");
    expect(rpc).toHaveBeenCalledWith("queue_handback", expect.objectContaining({ p_task: id, p_reason: "outside_competence" }));
  });

  it("tells the clinician when they no longer hold the task", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "queue_no_claim" } });
    const result = await handBack(undefined, form({ task_id: id, reason: "outside_competence" }));
    expect(result?.error).toMatch(/no longer hold/);
  });
});

describe("extendClaim", () => {
  it("rejects a malformed id without calling the database", async () => {
    const result = await extendClaim(undefined, form({ task_id: "nope" }));
    expect(result?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports a used-up extension plainly", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "queue_extension_used" } });
    const result = await extendClaim(undefined, form({ task_id: id }));
    expect(result?.error).toMatch(/already used/);
  });

  it("confirms an extension", async () => {
    rpc.mockResolvedValue({ data: "2026-10-06T12:00:00Z", error: null });
    expect(await extendClaim(undefined, form({ task_id: id }))).toEqual({ message: "extended", expiresAt: "2026-10-06T12:00:00Z" });
  });
});
