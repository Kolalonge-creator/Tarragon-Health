import { blocksUse, defaultSectionFor, findOmissions, isFactInDraft, unresolvedOmissions } from "./omissions";
import type { FactType, ScribeFact } from "./facts";

const fact = (id: string, type: FactType, text: string): ScribeFact => ({ id, type, text, quote: text, speaker: "patient" });

describe("isFactInDraft", () => {
  it("a symptom said in the draft is covered, whatever the wording of the rest of the sentence", () => {
    expect(isFactInDraft(fact("f1", "symptom", "Headache for three days"), "Presents with a headache lasting three days.")).toBe(true);
  });

  it("a symptom the draft never mentions is an omission", () => {
    expect(isFactInDraft(fact("f1", "symptom", "Vomiting twice since morning"), "Presents with a headache.")).toBe(false);
  });

  it("plural and tense differences do not cause a false flag", () => {
    expect(isFactInDraft(fact("f1", "symptom", "Vomiting twice"), "Vomited twice overnight.")).toBe(true);
  });

  it("a negation kept as a negation is covered", () => {
    expect(isFactInDraft(fact("f1", "negated_symptom", "No chest pain"), "Denies chest pain.")).toBe(true);
    expect(isFactInDraft(fact("f1", "negated_symptom", "No chest pain"), "Cough for two days. No chest pain or breathlessness.")).toBe(true);
  });

  it("a negation reversed in the draft is an omission, not a pass (the dangerous case)", () => {
    expect(isFactInDraft(fact("f1", "negated_symptom", "No chest pain"), "Reports chest pain on exertion.")).toBe(false);
  });

  it("the negation and the symptom in different sentences do not count as the negation being kept", () => {
    expect(isFactInDraft(fact("f1", "negated_symptom", "No chest pain"), "Chest pain on exertion. No cough.")).toBe(false);
  });

  it("an allergy is matched across allergic, allergy and allergies", () => {
    expect(isFactInDraft(fact("f1", "allergy", "Allergic to penicillin"), "Penicillin allergy noted.")).toBe(true);
    expect(isFactInDraft(fact("f1", "allergy", "Allergic to penicillin"), "No known drug allergies.")).toBe(false);
  });

  it("numbers must be present", () => {
    expect(isFactInDraft(fact("f1", "measurement_or_finding", "BP 150/90"), "Blood pressure 150/90 today.")).toBe(true);
    expect(isFactInDraft(fact("f1", "measurement_or_finding", "BP 150/90"), "Blood pressure was raised.")).toBe(false);
  });

  it("a fact with no checkable words is not invented into an omission", () => {
    expect(isFactInDraft(fact("f1", "symptom", "It is"), "")).toBe(true);
  });
});

describe("findOmissions", () => {
  const facts = [
    fact("a", "symptom", "Cough for two days"),
    fact("b", "negated_symptom", "No chest pain"),
    fact("c", "medication_mentioned", "Takes amlodipine 5 mg"),
    fact("d", "allergy", "Allergic to penicillin"),
  ];

  it("a complete draft has no omissions", () => {
    const text = "Cough for two days. No chest pain. Penicillin allergy. Medication plan discussed with the clinician.";
    expect(findOmissions(facts, text)).toEqual([]);
  });

  it("medication facts are never flagged: the draft is forbidden to name the medicine (INV-02)", () => {
    const text = "Cough for two days. No chest pain. Penicillin allergy.";
    expect(findOmissions(facts, text).map((o) => o.fact.id)).not.toContain("c");
  });

  it("lists safety omissions before the others, and marks them", () => {
    const out = findOmissions(facts, "Presents well.");
    expect(out.map((o) => [o.fact.id, o.safety])).toEqual([
      ["b", true],
      ["d", true],
      ["a", false],
    ]);
  });
});

describe("resolving omissions", () => {
  const facts = [fact("a", "symptom", "Cough for two days"), fact("b", "negated_symptom", "No chest pain")];
  const omissions = findOmissions(facts, "Presents well.");

  it("an open safety omission blocks use", () => {
    expect(blocksUse(omissions, {})).toBe(true);
  });

  it("saying it was left out on purpose clears the block", () => {
    expect(blocksUse(omissions, { b: true })).toBe(false);
  });

  it("a non-safety omission alone never blocks", () => {
    expect(blocksUse(findOmissions([facts[0]], "Presents well."), {})).toBe(false);
  });

  it("unresolved lists only the ones not left out", () => {
    expect(unresolvedOmissions(omissions, { b: true }).map((o) => o.fact.id)).toEqual(["a"]);
  });

  it("adding the fact to the text resolves it with no extra bookkeeping", () => {
    expect(findOmissions(facts, "Presents well. No chest pain. Cough for two days.")).toEqual([]);
  });
});

describe("defaultSectionFor", () => {
  it("routes a fact to the section a clinician would look in", () => {
    expect(defaultSectionFor("measurement_or_finding")).toBe("examination");
    expect(defaultSectionFor("plan_item")).toBe("plan");
    expect(defaultSectionFor("red_flag")).toBe("followUp");
    expect(defaultSectionFor("negated_symptom")).toBe("history");
  });
});
