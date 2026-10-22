import { describeAvsError, parsePatientSummaries, reviewSchema, saveDraftSchema, withdrawSummarySchema } from "./schemas";

const id = "11111111-1111-4111-8111-111111111111";

describe("parsePatientSummaries", () => {
  it("reads a summary with its checklist and defaults missing parts", () => {
    const [s] = parsePatientSummaries([
      {
        id: "s1",
        note_id: "n1",
        summary_text: "Your blood pressure was a little high.",
        approved_at: "2026-10-16T09:00:00Z",
        approved_by_name: "Dr Ade",
        items: [{ id: "i1", kind: "medicine", params: { drug_name: "Amlodipine" }, done_at: null }, { id: "i2", kind: "lab" }],
      },
    ]);
    expect(s.items).toHaveLength(2);
    expect(s.items[1]).toMatchObject({ custom_text: null, due_on: null, done_at: null, task_id: null, params: {} });
    expect(s.revision).toBe(1);
  });

  it("drops an unreadable row instead of showing it half-filled, and treats a non-list as empty", () => {
    expect(parsePatientSummaries([{ id: "x" }, null, "nope"])).toEqual([]);
    expect(parsePatientSummaries(null)).toEqual([]);
    expect(parsePatientSummaries({ rows: [] })).toEqual([]);
  });
});

describe("reviewSchema", () => {
  it("accepts a note with no summary yet", () => {
    const r = reviewSchema.parse({ summary: null, note_signed: true, note_protected: false });
    expect(r.summary).toBeNull();
    expect(r.items).toEqual([]);
    expect(r.stale).toBe(false);
  });

  it("refuses an unknown state", () => {
    expect(reviewSchema.safeParse({ note_signed: true, summary: { id: "s", state: "published", revision: 1, summary_text: "x" } }).success).toBe(false);
  });
});

describe("action inputs", () => {
  it("bounds the draft and the checklist", () => {
    expect(saveDraftSchema.safeParse({ summaryId: id, text: "ok", items: [] }).success).toBe(true);
    expect(saveDraftSchema.safeParse({ summaryId: id, text: "x".repeat(4001), items: [] }).success).toBe(false);
    expect(saveDraftSchema.safeParse({ summaryId: id, text: "ok", items: Array.from({ length: 31 }, () => ({ kind: "custom" })) }).success).toBe(false);
    expect(saveDraftSchema.safeParse({ summaryId: id, text: "ok", items: [{ kind: "surgery" }] }).success).toBe(false);
    expect(saveDraftSchema.safeParse({ summaryId: id, text: "ok", items: [{ kind: "recheck", dueOn: "next week" }] }).success).toBe(false);
    expect(saveDraftSchema.safeParse({ summaryId: "nope", text: "ok", items: [] }).success).toBe(false);
  });

  it("needs a real reason to take a summary back", () => {
    expect(withdrawSummarySchema.safeParse({ summaryId: id, reason: "oops" }).success).toBe(false);
    expect(withdrawSummarySchema.safeParse({ summaryId: id, reason: " Wrong dose was written " }).success).toBe(true);
  });
});

describe("describeAvsError", () => {
  it.each([
    ["visit_summary_note_unsigned", /Sign the note first/],
    ["visit_summary_copy_rules", /plain-language rules/],
    ["visit_summary_text_needed", /at least 20/],
    ["only a doctor can approve a visit summary", /Only a doctor/],
  ])("maps %s to plain words", (message, expected) => {
    expect(describeAvsError({ message }, "fallback")).toMatch(expected);
  });

  it("falls back, and says access when the database refuses", () => {
    expect(describeAvsError({ message: "something else" }, "fallback")).toBe("fallback");
    expect(describeAvsError({ message: "x", code: "42501" }, "fallback")).toMatch(/access/);
    expect(describeAvsError(null, "fallback")).toBe("fallback");
  });
});
