/** S28c: the prescriber's overview and the fixed answers. Unreadable answers are failures, never "answered" or "nothing asked". */
const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
const revalidatePath = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import { answerPharmacyQuestion, loadPrescriberOverview } from "./prescriber-actions";

const FLAG = "7a4e2c1b-5d3f-4e8a-b6c9-0f1e2d3c4b5a";
const RX = "0b8f6d0e-3c1a-4f3e-9a52-1d6f6a9f7c11";
const overview = {
  questions: [{ question_id: FLAG, prescription_id: RX, asked_at: "2026-10-07T09:00:00Z", pharmacy_name: "A", reason_code: "dose_unclear", patient_name: "Ada", medicines: ["Amlodipine"], answered_at: null, answer_code: null }],
  collection: [{ prescription_id: RX, state: "sent", patient_name: "Ada", sent_at: "2026-10-07T09:00:00Z", dispensed_at: null, pharmacy_name: "A", medicines: ["Amlodipine"] }],
  earlier: [],
};
beforeEach(() => {
  rpc.mockReset();
  revalidatePath.mockReset();
});

describe("loadPrescriberOverview", () => {
  it("reads the overview", async () => {
    rpc.mockResolvedValue({ data: overview, error: null });
    const r = await loadPrescriberOverview();
    expect(r.ok && r.overview.questions[0]?.reason_code).toBe("dose_unclear");
    expect(rpc).toHaveBeenCalledWith("prescriber_pharmacy_overview", {});
  });
  it("an unreadable overview is a failed read, never an empty list", async () => {
    for (const data of [null, [], { questions: "none" }, { ...overview, collection: [{ state: "weird" }] }]) {
      rpc.mockResolvedValue({ data, error: null });
      await expect(loadPrescriberOverview()).resolves.toMatchObject({ ok: false });
    }
  });
  it("a patient or a stranger gets plain words, not the database's", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "This is for clinicians" } });
    await expect(loadPrescriberOverview()).resolves.toEqual({ ok: false, error: "This page is for clinicians." });
  });
});

describe("answerPharmacyQuestion", () => {
  it("answers from the fixed list only, and revalidates the page", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(answerPharmacyQuestion({ flagId: FLAG, answer: "keep_as_written" })).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("answer_pharmacy_question", { p_flag: FLAG, p_answer: "keep_as_written" });
    expect(revalidatePath).toHaveBeenCalledWith("/clinician/pharmacy");
  });
  it("refuses free text and a malformed id without calling the database", async () => {
    await expect(answerPharmacyQuestion({ flagId: FLAG, answer: "Yes, that is fine" })).resolves.toMatchObject({ ok: false });
    await expect(answerPharmacyQuestion({ flagId: "x", answer: "keep_as_written" })).resolves.toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("says so when it was already answered or has left the pharmacy, and never treats an unreadable answer as recorded", async () => {
    rpc.mockResolvedValue({ data: { ok: false, reason: "already_answered" }, error: null });
    await expect(answerPharmacyQuestion({ flagId: FLAG, answer: "keep_as_written" })).resolves.toEqual({ ok: false, error: "That question has already been answered." });
    rpc.mockResolvedValue({ data: { ok: false, reason: "not_waiting" }, error: null });
    await expect(answerPharmacyQuestion({ flagId: FLAG, answer: "keep_as_written" })).resolves.toMatchObject({ ok: false, error: expect.stringContaining("no longer waiting") });
    rpc.mockResolvedValue({ data: "ok", error: null });
    await expect(answerPharmacyQuestion({ flagId: FLAG, answer: "keep_as_written" })).resolves.toMatchObject({ ok: false });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
