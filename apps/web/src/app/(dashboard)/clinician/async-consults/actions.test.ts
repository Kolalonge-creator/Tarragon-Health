const rpc = jest.fn();
const redirect = jest.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

jest.mock("next/navigation", () => ({ redirect: (p: string) => redirect(p) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ rpc: (...args: unknown[]) => rpc(...args) }),
}));

import { answerWrittenQuestion, handBackTask, markCallDone, takeNextTask } from "./actions";

const id = "11111111-1111-4111-8111-111111111111";
const form = (entries: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};
const reply = { consult_id: id, kind: "guidance", body: "Rest, fluids, and call us if it gets worse." };

beforeEach(() => {
  rpc.mockReset();
  redirect.mockClear();
});

describe("answerWrittenQuestion", () => {
  it("rejects an unticked attestation before calling the database", async () => {
    const result = await answerWrittenQuestion(undefined, form(reply));
    expect(result?.error).toMatch(/not made a diagnosis/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends the attested reply with no diagnosis argument", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await expect(answerWrittenQuestion(undefined, form({ ...reply, attested: "on" }))).rejects.toThrow("REDIRECT:/clinician/async-consults?replied=guidance");
    expect(rpc).toHaveBeenCalledWith("answer_written_question", {
      p_consult: id,
      p_kind: "guidance",
      p_body: reply.body,
      p_attested: true,
    });
  });

  it("carries a 'needs a call' outcome to the confirmation on the list page", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await expect(
      answerWrittenQuestion(undefined, form({ ...reply, kind: "needs_call", attested: "on" })),
    ).rejects.toThrow("REDIRECT:/clinician/async-consults?replied=needs_call");
  });

  it("maps a lost claim to plain words", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "queue_no_claim", code: "42501" } });
    const result = await answerWrittenQuestion(undefined, form({ ...reply, attested: "on" }));
    expect(result?.error).toMatch(/no longer hold/);
  });

  it("refuses a kind that is not one of the three", async () => {
    const result = await answerWrittenQuestion(undefined, form({ ...reply, kind: "diagnosis", attested: "on" }));
    expect(result?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("handBackTask", () => {
  it("needs a note for Another reason, without calling the database", async () => {
    const result = await handBackTask(undefined, form({ task_id: id, reason: "other" }));
    expect(result?.error).toMatch(/note/i);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("hands back and returns to the list", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(handBackTask(undefined, form({ task_id: id, reason: "outside_competence" }))).rejects.toThrow("REDIRECT:/clinician/async-consults");
    expect(rpc).toHaveBeenCalledWith("queue_handback", { p_task: id, p_reason: "outside_competence" });
  });
});

describe("takeNextTask", () => {
  it("never silently drops a task that is not a written question", async () => {
    rpc.mockResolvedValue({ data: { already_claimed: false, task: { id, type: "triage_review" } }, error: null });
    await expect(takeNextTask()).rejects.toThrow(`REDIRECT:/clinician/async-consults?held=${id}&type=triage_review`);
  });
  it("asks the queue for written-question work only", async () => {
    rpc.mockResolvedValue({ data: { already_claimed: false, task: { id, type: "async_question" } }, error: null });
    await expect(takeNextTask()).rejects.toThrow("REDIRECT:/clinician/async-consults");
    expect(rpc).toHaveBeenCalledWith("queue_next", { p_types: ["async_question", "written_question_call"] });
  });
  it("stays on the page when the claim is a call task", async () => {
    rpc.mockResolvedValue({ data: { already_claimed: false, task: { id, type: "written_question_call" } }, error: null });
    await expect(takeNextTask()).rejects.toThrow(/^REDIRECT:\/clinician\/async-consults$/);
  });
  it("shows an already-held task of another type as held, never silently", async () => {
    rpc.mockResolvedValue({ data: { already_claimed: true, task: { id, type: "bp_review" } }, error: null });
    await expect(takeNextTask()).rejects.toThrow(`REDIRECT:/clinician/async-consults?held=${id}&type=bp_review`);
  });
  it("reports a closed queue in words", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "queue_cooling_off", code: "42501" } });
    const result = await takeNextTask();
    expect(result?.error).toMatch(/handed back/);
  });
});

describe("markCallDone", () => {
  it("refuses a note under 10 characters without calling the database", async () => {
    const result = await markCallDone(undefined, form({ task_id: id, note: "short" }));
    expect(result?.error).toMatch(/10 characters/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses a note over 1000 characters", async () => {
    const result = await markCallDone(undefined, form({ task_id: id, note: "x".repeat(1001) }));
    expect(result?.error).toMatch(/1,000/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("completes the call task with a call_done outcome", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(markCallDone(undefined, form({ task_id: id, note: "  Spoke to the patient, advised review.  " }))).rejects.toThrow(
      "REDIRECT:/clinician/async-consults",
    );
    expect(rpc).toHaveBeenCalledWith("queue_complete", {
      p_task: id,
      p_outcome: { kind: "call_done", note: "Spoke to the patient, advised review." },
    });
  });
  it("maps a lost claim to plain words", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "queue_no_claim", code: "42501" } });
    const result = await markCallDone(undefined, form({ task_id: id, note: "Spoke to the patient." }));
    expect(result?.error).toMatch(/no longer hold/);
  });
});
