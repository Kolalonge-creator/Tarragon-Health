const rpc = jest.fn();
const redirect = jest.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

jest.mock("next/navigation", () => ({ redirect: (p: string) => redirect(p) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ rpc: (...args: unknown[]) => rpc(...args) }),
}));

import { answerWrittenQuestion, handBackTask, takeNextTask } from "./actions";

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
    const result = await answerWrittenQuestion(undefined, form({ ...reply, attested: "on" }));
    expect(result?.message).toBeDefined();
    expect(rpc).toHaveBeenCalledWith("answer_written_question", {
      p_consult: id,
      p_kind: "guidance",
      p_body: reply.body,
      p_attested: true,
    });
  });

  it("tells the clinician a call task was created for 'needs a call'", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    const result = await answerWrittenQuestion(undefined, form({ ...reply, kind: "needs_call", attested: "on" }));
    expect(result?.message).toMatch(/told they will be called/);
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
    expect(rpc).toHaveBeenCalledWith("queue_handback", { p_task: id, p_reason: "outside_competence", p_note: null });
  });
});

describe("takeNextTask", () => {
  it("never silently drops a task that is not a written question", async () => {
    rpc.mockResolvedValue({ data: { already_claimed: false, task: { id, type: "triage_review" } }, error: null });
    await expect(takeNextTask()).rejects.toThrow(`REDIRECT:/clinician/async-consults?held=${id}&type=triage_review`);
  });
  it("reports a closed queue in words", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "queue_cooling_off", code: "42501" } });
    const result = await takeNextTask();
    expect(result?.error).toMatch(/handed back/);
  });
});
