import { EMPTY_REVIEW, addFact, canWriteDraft, confirmedFacts, decide, editText, orderedForReview, removeAdded, undecided } from "./facts-review";
import type { ScribeFact } from "./facts";

const f = (id: string, type: ScribeFact["type"] = "symptom", text = `fact ${id}`): ScribeFact => ({ id, type, text, quote: "q", speaker: "patient" });
const facts = [f("f1"), f("f2", "negated_symptom", "No chest pain."), f("f3", "medication_mentioned")];

describe("facts review", () => {
  it("cannot write a draft until every fact is decided", () => {
    let s = decide(EMPTY_REVIEW, "f1", "confirmed");
    expect(canWriteDraft(facts, s)).toBe(false);
    expect(undecided(facts, s).map((x) => x.id)).toEqual(["f2", "f3"]);
    s = decide(decide(s, "f2", "confirmed"), "f3", "rejected");
    expect(canWriteDraft(facts, s)).toBe(true);
  });
  it("cannot write a draft from nothing confirmed", () => {
    let s = EMPTY_REVIEW;
    for (const x of facts) s = decide(s, x.id, "rejected");
    expect(canWriteDraft(facts, s)).toBe(false);
  });
  it("only confirmed facts go on, with corrected text", () => {
    let s = decide(decide(decide(EMPTY_REVIEW, "f1", "confirmed"), "f2", "rejected"), "f3", "confirmed");
    s = editText(s, "f1", "  Headache for 3 weeks.  ");
    expect(confirmedFacts(facts, s).map((x) => [x.id, x.text])).toEqual([["f1", "Headache for 3 weeks."], ["f3", "fact f3"]]);
  });
  it("an emptied edit falls back to the original text", () => {
    const s = editText(decide(EMPTY_REVIEW, "f1", "confirmed"), "f1", "   ");
    expect(confirmedFacts([f("f1")], s)[0]?.text).toBe("fact f1");
  });
  it("a fact the clinician adds counts as confirmed, has no quote, and can be removed", () => {
    let s = addFact(EMPTY_REVIEW, "allergy", "  Allergic to penicillin.  ");
    expect(s.added[0]).toMatchObject({ id: "c1", type: "allergy", text: "Allergic to penicillin.", quote: "", speaker: "clinician" });
    expect(confirmedFacts([], s)).toHaveLength(1);
    expect(canWriteDraft([], s)).toBe(true);
    s = removeAdded(s, "c1");
    expect(canWriteDraft([], s)).toBe(false);
  });
  it("ignores an empty added fact", () => {
    expect(addFact(EMPTY_REVIEW, "symptom", "   ")).toBe(EMPTY_REVIEW);
  });
  it("a decision can be taken back", () => {
    const s = decide(decide(EMPTY_REVIEW, "f1", "confirmed"), "f1", null);
    expect(undecided([f("f1")], s)).toHaveLength(1);
  });
  it("shows negations and safety items first", () => {
    expect(orderedForReview(facts).map((x) => x.id)).toEqual(["f2", "f3", "f1"]);
  });
});
