import { afterEdit, canUseDraft, possibleOmissions, setConfirmed, unconfirmed, type DraftFields } from "./draft-review";

const full: DraftFields = { history: "h", examination: "e", assessment: "a", plan: "p", followUp: "f", patientSummary: "s" };

describe("possibleOmissions", () => {
  it("is empty when every section has text", () => {
    expect(possibleOmissions(full)).toEqual([]);
  });
  it("flags empty and whitespace-only sections, in display order", () => {
    expect(possibleOmissions({ ...full, followUp: "  \n", examination: "" })).toEqual(["examination", "followUp"]);
  });
});

describe("confirmation", () => {
  it("starts with every section unconfirmed and the draft unusable", () => {
    expect(unconfirmed({})).toHaveLength(6);
    expect(canUseDraft({})).toBe(false);
  });
  it("is usable only when all six are confirmed", () => {
    let c = {};
    for (const k of ["history", "examination", "assessment", "plan", "followUp"] as const) c = setConfirmed(c, k, true);
    expect(canUseDraft(c)).toBe(false);
    c = setConfirmed(c, "patientSummary", true);
    expect(canUseDraft(c)).toBe(true);
  });
  it("an edit clears only that section", () => {
    let c = {};
    for (const k of ["history", "plan"] as const) c = setConfirmed(c, k, true);
    c = afterEdit(c, "plan");
    expect(unconfirmed(c)).not.toContain("history");
    expect(unconfirmed(c)).toContain("plan");
  });
  it("does not change its input", () => {
    const before = { history: true as const };
    setConfirmed(before, "plan", true);
    expect(before).toEqual({ history: true });
  });
});
