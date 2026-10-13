import {
  FACTS_SCHEMA,
  FACT_TYPES,
  buildFactsDraftUserMessage,
  buildFactsUserMessage,
  groundingWarnings,
  normaliseForQuote,
  verifyFacts,
  type ScribeFact,
} from "./facts";

const transcript = "PATIENT: I have had headaches for two weeks. No chest pain. My BP at the pharmacy was 168 over 100.\nCLINICIAN: Come back if the headache is severe.";

describe("verifyFacts", () => {
  const good = { type: "negated_symptom", text: "No chest pain.", quote: "No chest pain.", speaker: "patient" };
  it("keeps a fact whose quote is in the source, case and punctuation aside, and numbers it f1..", () => {
    const out = verifyFacts({ facts: [good, { ...good, type: "symptom", text: "Headaches for two weeks.", quote: "headaches for two weeks" }] }, transcript);
    expect(out.facts.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(out.dropped).toBe(0);
  });
  it("drops a fact whose quote is invented, and counts it", () => {
    const out = verifyFacts({ facts: [good, { ...good, text: "Fever.", quote: "I have a fever and chills" }] }, transcript);
    expect(out.facts).toHaveLength(1);
    expect(out.dropped).toBe(1);
  });
  it("drops an empty quote, an unknown type, a missing speaker and an over-long text", () => {
    const bad = [
      { ...good, quote: "" },
      { ...good, type: "diagnosis" },
      { ...good, speaker: undefined },
      { ...good, text: "x".repeat(301) },
    ];
    const out = verifyFacts({ facts: bad }, transcript);
    expect(out.facts).toHaveLength(0);
    expect(out.dropped).toBe(4);
  });
  it("does not trust a quote that is only a fragment of unrelated words", () => {
    expect(verifyFacts({ facts: [{ ...good, quote: "chest chest" }] }, transcript).dropped).toBe(1);
  });
  it("handles a missing or malformed list", () => {
    expect(verifyFacts(null, transcript)).toEqual({ facts: [], dropped: 0 });
    expect(verifyFacts({ facts: "no" }, transcript)).toEqual({ facts: [], dropped: 0 });
  });
  it("caps the number of facts kept", () => {
    const many = Array.from({ length: 70 }, () => good);
    const out = verifyFacts({ facts: many }, transcript);
    expect(out.facts).toHaveLength(60);
    expect(out.dropped).toBe(10);
  });
});

describe("groundingWarnings", () => {
  const facts: ScribeFact[] = [
    { id: "f1", type: "symptom", text: "Headaches for 2 weeks.", quote: "q", speaker: "patient" },
    { id: "f2", type: "measurement_or_finding", text: "BP 168/100.", quote: "q", speaker: "patient" },
  ];
  const draft = { history: "Headaches for 2 weeks.", examination: "BP 168/100.", assessment: "", plan: "", followUp: "" };
  const cites = { history: ["f1"], examination: ["f2"], assessment: [], plan: [], followUp: [] };

  it("is clean when every section is cited and every number is in the facts", () => {
    expect(groundingWarnings(draft, cites, facts)).toEqual([]);
  });
  it("flags text with no citation", () => {
    expect(groundingWarnings(draft, { ...cites, history: [] }, facts)).toContainEqual({ section: "history", kind: "uncited_text" });
  });
  it("flags a citation to a fact that was not confirmed", () => {
    expect(groundingWarnings(draft, { ...cites, history: ["f9"] }, facts)).toContainEqual({ section: "history", kind: "unknown_fact_id", detail: "f9" });
  });
  it("flags a number the facts do not contain", () => {
    expect(groundingWarnings({ ...draft, plan: "Recheck in 14 days." }, { ...cites, plan: ["f1"] }, facts)).toContainEqual({ section: "plan", kind: "number_not_in_facts", detail: "14" });
  });
  it("flags citations on an empty section", () => {
    expect(groundingWarnings(draft, { ...cites, plan: ["f1"] }, facts)).toContainEqual({ section: "plan", kind: "empty_but_cited" });
  });
});

describe("messages and schema", () => {
  it("the facts message carries the typed-notes line only for typed input", () => {
    expect(buildFactsUserMessage("en-NG", "PATIENT: hi", true)).toContain("Input type: notes the clinician typed");
    expect(buildFactsUserMessage("en-NG", "PATIENT: hi", false)).not.toContain("Input type");
  });
  it("the draft message contains the confirmed facts and never a transcript", () => {
    const m = buildFactsDraftUserMessage("pcm", [{ id: "f1", type: "symptom", text: "Headache.", quote: "secret quote", speaker: "patient" }], { age: 50 });
    expect(m).toContain("f1 [symptom] Headache.");
    expect(m).not.toContain("secret quote");
    expect(m).not.toContain("Transcript");
  });
  it("the schema enumerates exactly the fact types", () => {
    expect(FACTS_SCHEMA.properties.facts.items.properties.type.enum).toEqual([...FACT_TYPES]);
  });
  it("normalises quotes the same way on both sides", () => {
    expect(normaliseForQuote("Don’t  take it, twice-daily!")).toBe("dont take it twice daily");
  });
});
