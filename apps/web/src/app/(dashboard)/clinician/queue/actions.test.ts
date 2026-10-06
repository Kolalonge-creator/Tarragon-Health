const rpc = jest.fn();
const redirect = jest.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

jest.mock("next/navigation", () => ({ redirect: (p: string) => redirect(p) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ rpc: (...args: unknown[]) => rpc(...args) }),
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

describe("completeTask", () => {
  it("refuses a short note before calling the database", async () => {
    const result = await completeTask(undefined, form({ task_id: id, note: "ok" }));
    expect(result?.error).toMatch(/10 characters/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("completes with an outcome object and returns to the queue", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(completeTask(undefined, form({ task_id: id, note: "Called the patient and agreed a recheck." }))).rejects.toThrow("REDIRECT:/clinician/queue?done=1");
    expect(rpc).toHaveBeenCalledWith("queue_complete", { p_task: id, p_outcome: { kind: "completed", note: "Called the patient and agreed a recheck." } });
  });

  it("says so when the hold has lapsed", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "queue_claim_expired" } });
    const result = await completeTask(undefined, form({ task_id: id, note: "Called the patient and agreed a recheck." }));
    expect(result?.error).toMatch(/run out/);
  });
});

describe("handBack", () => {
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
    expect(await extendClaim(undefined, form({ task_id: id }))).toEqual({ message: "extended" });
  });
});
