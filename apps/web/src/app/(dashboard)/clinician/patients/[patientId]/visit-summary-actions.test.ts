const rpc = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ rpc: (...args: unknown[]) => rpc(...args) }),
}));

import {
  approveVisitSummary,
  loadVisitSummaryReview,
  saveVisitSummaryDraft,
  startVisitSummaryDraft,
  withdrawVisitSummary,
} from "./visit-summary-actions";

const id = "11111111-1111-4111-8111-111111111111";
const itemId = "22222222-2222-4222-8222-222222222222";

beforeEach(() => rpc.mockReset());

describe("startVisitSummaryDraft", () => {
  it("refuses a bad id without calling the database", async () => {
    expect((await startVisitSummaryDraft({ noteId: "nope" })).error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls assemble with exactly p_note and maps the unsigned-note error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "visit_summary_note_unsigned", code: "P0001" } });
    const r = await startVisitSummaryDraft({ noteId: id });
    expect(rpc).toHaveBeenCalledWith("assemble_visit_summary", { p_note: id });
    expect(r.error).toMatch(/Sign the note first/);
  });
});

describe("loadVisitSummaryReview", () => {
  it("reports a failed read as a failure, never as no summary", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const r = await loadVisitSummaryReview({ noteId: id });
    expect(r.review).toBeUndefined();
    expect(r.error).toBeDefined();
  });

  it("reports an unreadable answer as a failure", async () => {
    rpc.mockResolvedValue({ data: { nonsense: true }, error: null });
    expect((await loadVisitSummaryReview({ noteId: id })).error).toBeDefined();
  });

  it("returns the review when the shape is right", async () => {
    rpc.mockResolvedValue({ data: { summary: null, note_signed: true, note_protected: false }, error: null });
    const r = await loadVisitSummaryReview({ noteId: id });
    expect(rpc).toHaveBeenCalledWith("read_visit_summary_for_review", { p_note: id });
    expect(r.review?.note_signed).toBe(true);
  });
});

describe("saveVisitSummaryDraft", () => {
  it("sends the checklist in the database's shape and never a signature field", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await saveVisitSummaryDraft({
      summaryId: id,
      text: "Your care team checked your blood pressure today.",
      items: [{ id: itemId, kind: "medicine", params: { drug_name: "Amlodipine" } }, { kind: "recheck", customText: "Check again", dueOn: "2026-11-03" }],
    });
    const [name, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe("update_visit_summary_draft");
    expect(Object.keys(args).sort()).toEqual(["p_items", "p_summary", "p_text"]);
    expect(args.p_items).toEqual([
      { id: itemId, kind: "medicine", params: { drug_name: "Amlodipine" }, custom_text: "", due_on: "" },
      { kind: "recheck", params: {}, custom_text: "Check again", due_on: "2026-11-03" },
    ]);
  });

  it("refuses an over-long text without calling the database", async () => {
    const r = await saveVisitSummaryDraft({ summaryId: id, text: "x".repeat(4001), items: [] });
    expect(r.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("approveVisitSummary", () => {
  it("checks the copy rules first and does not call the database when they fail", async () => {
    const r = await approveVisitSummary({ summaryId: id, text: "Ask your doctor — it will cure this." });
    expect(r.error).toMatch(/plain-language rules/);
    expect(r.problems).toEqual(expect.arrayContaining(["dash", "your_doctor", "cure"]));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("approves with only the summary id: the database stamps who and when", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await approveVisitSummary({ summaryId: id, text: "Your care team checked your blood pressure today." });
    expect(rpc).toHaveBeenCalledWith("approve_visit_summary", { p_summary: id });
    expect(r.message).toBe("approved");
  });

  it("passes the database's own copy problems back", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "visit_summary_copy_rules", code: "22023", details: "dash,warning" } });
    const r = await approveVisitSummary({ summaryId: id, text: "A text that looks fine to the browser check." });
    expect(r.problems).toEqual(["dash", "warning"]);
  });

  it("says only a doctor can when the database refuses", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "only a doctor can work on a visit summary", code: "42501" } });
    expect((await approveVisitSummary({ summaryId: id, text: "Your care team checked your blood pressure today." })).error).toMatch(/Only a doctor/);
  });
});

describe("withdrawVisitSummary", () => {
  it("refuses a short reason, trims a good one", async () => {
    expect((await withdrawVisitSummary({ summaryId: id, reason: "oops" })).error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: null });
    await withdrawVisitSummary({ summaryId: id, reason: "  The dose was written wrongly  " });
    expect(rpc).toHaveBeenCalledWith("withdraw_visit_summary", { p_summary: id, p_reason: "The dose was written wrongly" });
  });
});
