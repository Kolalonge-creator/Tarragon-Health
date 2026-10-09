jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { revalidatePath } from "next/cache";
import { answerQuestionAction } from "./actions";

const POST = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  rpc.mockReset();
  (revalidatePath as jest.Mock).mockReset();
});

describe("answerQuestionAction", () => {
  it("sends the trimmed answer and refreshes the page", async () => {
    rpc.mockResolvedValue({ data: { status: "ok", id: "x" }, error: null });
    const r = await answerQuestionAction({ postId: POST, body: "  Drink water and visit your clinic.  " });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("community_qa_answer", { p_post_id: POST, p_body: "Drink water and visit your clinic." });
    expect(revalidatePath).toHaveBeenCalledWith("/clinician/community/qa");
  });
  it("rejects an answer under 5 or over 1500 characters, and a bad id, before any call", async () => {
    expect((await answerQuestionAction({ postId: POST, body: "no" })).ok).toBe(false);
    expect((await answerQuestionAction({ postId: POST, body: "x".repeat(1501) })).ok).toBe(false);
    expect((await answerQuestionAction({ postId: "x", body: "A fine answer" })).ok).toBe(false);
    expect((await answerQuestionAction(undefined)).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("accepts exactly 5 and exactly 1500 characters", async () => {
    rpc.mockResolvedValue({ data: { status: "ok" }, error: null });
    expect((await answerQuestionAction({ postId: POST, body: "12345" })).ok).toBe(true);
    expect((await answerQuestionAction({ postId: POST, body: "x".repeat(1500) })).ok).toBe(true);
  });
  it.each([
    ["qa_closed", "This session is not open for answers right now."],
    ["text_not_allowed", "That text has a phone number, email, link or other wording the community filters refuse. Please rewrite it."],
    ["bad_length", "Please write an answer of 5 to 1500 characters."],
    ["not_found", "That could not be found. It may have been removed already."],
  ])("explains a %s refusal in plain English", async (reason, message) => {
    rpc.mockResolvedValue({ data: { status: "refused", reason }, error: null });
    expect(await answerQuestionAction({ postId: POST, body: "A fine answer" })).toEqual({ ok: false, message });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("tells a doctor who is not named on the session, never raising database text", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "named doctors only" } });
    const r = await answerQuestionAction({ postId: POST, body: "A fine answer" });
    expect(r).toEqual({ ok: false, message: "You are not named on this session, so you cannot answer here." });
  });
});
