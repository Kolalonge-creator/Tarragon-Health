import { webcrypto } from "node:crypto";
import { canonicalDraft, draftHash, sectionOutcomes, sectionState } from "./review-record";
import type { DraftFields } from "./draft-review";

const draft: DraftFields = { history: "Headache two days.", examination: "", assessment: "Tension headache.", plan: "Rest.", followUp: "Call if worse.", patientSummary: "Summary." };

describe("sectionState", () => {
  it("unchanged when the final text holds the draft as generated, even with text added around it", () => {
    expect(sectionState("Rest.", "Rest.")).toBe("unchanged");
    expect(sectionState("Rest.", "Earlier note.\n\nRest.")).toBe("unchanged");
    expect(sectionState("Rest and  fluids.", "Rest and fluids.")).toBe("unchanged");
  });
  it("edited when the draft text is no longer there", () => {
    expect(sectionState("Rest.", "Rest and paracetamol.")).toBe("edited");
    expect(sectionState("Rest and fluids.", "Rest only.")).toBe("edited");
  });
  it("emptied, added and empty_kept", () => {
    expect(sectionState("Rest.", "  ")).toBe("emptied");
    expect(sectionState("", "Examined.")).toBe("added");
    expect(sectionState("", "")).toBe("empty_kept");
  });
});

describe("sectionOutcomes", () => {
  it("flags the sections that were empty in the draft, and reports each outcome", () => {
    const final: DraftFields = { ...draft, examination: "BP 150/95", plan: "Rest and fluids and a recheck." };
    const out = sectionOutcomes(draft, final);
    expect(out.examination).toEqual({ state: "added", flagged_empty: true });
    expect(out.plan).toEqual({ state: "edited", flagged_empty: false });
    expect(out.history).toEqual({ state: "unchanged", flagged_empty: false });
    expect(Object.keys(out)).toHaveLength(6);
  });
});

describe("draftHash", () => {
  it("is a stable 64 character hex string for the same draft", async () => {
    const a = await draftHash(draft, webcrypto.subtle);
    const b = await draftHash({ ...draft }, webcrypto.subtle);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });
  it("changes when any section changes", async () => {
    const a = await draftHash(draft, webcrypto.subtle);
    const b = await draftHash({ ...draft, plan: "Rest!" }, webcrypto.subtle);
    expect(a).not.toBe(b);
  });
  it("does not depend on object key order", () => {
    const reordered = { patientSummary: draft.patientSummary, followUp: draft.followUp, plan: draft.plan, assessment: draft.assessment, examination: draft.examination, history: draft.history };
    expect(canonicalDraft(reordered)).toBe(canonicalDraft(draft));
  });
});
