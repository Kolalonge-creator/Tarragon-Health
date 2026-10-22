import { parseVisitSummaries } from "./parse";

describe("parseVisitSummaries", () => {
  const good = {
    id: "s1",
    note_id: "n1",
    summary_text: "Your blood pressure was a little high.",
    approved_at: "2026-10-16T09:00:00Z",
    approved_by_name: "Dr Ade",
    items: [
      { id: "i1", kind: "medicine", params: { drug_name: "Amlodipine" }, custom_text: null, due_on: null, done_at: null, task_id: null },
      { id: "i2", kind: "recheck", params: {}, custom_text: "Check at home", due_on: "2026-10-23", done_at: "2026-10-17T08:00:00Z", task_id: "t1" },
      { kind: "lab" },
    ],
  };

  it("reads a summary and its checklist, skipping an unreadable item", () => {
    const [s] = parseVisitSummaries([good]);
    expect(s.items).toHaveLength(2);
    expect(s.items[0]).toMatchObject({ kind: "medicine", doneAt: null, taskId: null });
    expect(s.items[1]).toMatchObject({ customText: "Check at home", dueOn: "2026-10-23", taskId: "t1" });
    expect(s.approvedByName).toBe("Dr Ade");
  });

  it("drops a row without an id, a note or text, and treats anything else as empty", () => {
    expect(parseVisitSummaries([{ id: "x" }, { note_id: "n" }, "nope", null])).toEqual([]);
    expect(parseVisitSummaries(null)).toEqual([]);
    expect(parseVisitSummaries({ not: "a list" })).toEqual([]);
  });

  it("defaults a missing checklist to empty", () => {
    const [s] = parseVisitSummaries([{ id: "s", note_id: "n", summary_text: "Hello there" }]);
    expect(s.items).toEqual([]);
  });
});
