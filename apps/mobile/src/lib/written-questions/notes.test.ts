import { canRequestRelease, checkCorrectionText, correctionStateKey, parseNoteIndex, parseReleasedNotes, visibleSections } from "./notes";

describe("parseNoteIndex", () => {
  it("parses release states and defaults unknown to not_requested", () => {
    const rows = parseNoteIndex([
      { id: "n1", encounter_type: "consult", signed_at: "2026-10-01T00:00:00Z", release_state: "declined", withhold_reason: "Needs a call first" },
      { id: "n2", signed_at: "2026-10-02T00:00:00Z", release_state: "weird" },
      { id: "n3" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ releaseState: "declined", withholdReason: "Needs a call first" });
    expect(rows[1].releaseState).toBe("not_requested");
  });
});

describe("parseReleasedNotes and sections", () => {
  const raw = [
    { id: "n1", signed_at: "2026-10-01T00:00:00Z", amends_note_id: "n0", amendment_kind: "correction", amendment_reason: "Wrong dose", reason: "Cough", plan: "Rest", history: "  ", corrections: [{ id: "c1", state: "annotated", request_text: "My age is wrong", response: null, created_at: "2026-10-03T00:00:00Z" }] },
  ];
  it("keeps amendments and corrections", () => {
    const [n] = parseReleasedNotes(raw);
    expect(n.amendmentKind).toBe("correction");
    expect(n.corrections[0].state).toBe("annotated");
  });
  it("shows only sections with text, in order", () => {
    const [n] = parseReleasedNotes(raw);
    expect(visibleSections(n).map((s) => s.key)).toEqual(["notes.section.reason", "notes.section.plan"]);
  });
});

describe("release and correction rules", () => {
  it("offers the request only before a request or after a decline", () => {
    expect(canRequestRelease("not_requested")).toBe(true);
    expect(canRequestRelease("declined")).toBe(true);
    expect(canRequestRelease("requested")).toBe(false);
    expect(canRequestRelease("released")).toBe(false);
  });
  it("checks correction length 10 to 2000", () => {
    expect(checkCorrectionText("short")).toBe(false);
    expect(checkCorrectionText("This detail is wrong")).toBe(true);
    expect(checkCorrectionText("a".repeat(2001))).toBe(false);
  });
  it("maps correction states to keys", () => {
    expect(correctionStateKey("declined")).toBe("notes.correction.declined");
  });
});
