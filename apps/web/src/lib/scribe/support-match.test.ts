import { matchSentences, sentenceKey, splitSentences, stem, unsupportedSentences, visitLines } from "./support-match";

const SOURCE = [
  "Headaches for two days, worse in the mornings.",
  "No vomiting. Temperature 37.2 today.",
  "Blood pressure 150/95 on the home monitor.",
].join("\n");

describe("support matching", () => {
  it("stems plurals and endings", () => {
    expect(stem("headaches")).toBe(stem("headache"));
    expect(stem("vomiting")).toBe(stem("vomited"));
  });

  it("splits sentences and lines", () => {
    expect(splitSentences("One thing. Another thing!\nThird")).toEqual(["One thing.", "Another thing!", "Third"]);
    expect(visitLines("a\n\n b \n")).toEqual(["a", "b"]);
  });

  it("marks a sentence whose words are in the visit text as supported and links the line", () => {
    const [s] = matchSentences("Headache for two days, worse in the morning.", SOURCE);
    expect(s.support).toBe("supported");
    expect(s.sourceLine).toBe(0);
  });

  it("marks a sentence with invented content as not said in the visit", () => {
    const out = matchSentences("Patient has a history of asthma and uses a salbutamol inhaler daily.", SOURCE);
    expect(out[0].support).toBe("unsupported");
  });

  it("a number that was not said makes the sentence unsupported even when the words match", () => {
    expect(matchSentences("Blood pressure 180/110 on the home monitor.", SOURCE)[0].support).toBe("unsupported");
    expect(matchSentences("Blood pressure 150/95 on the home monitor.", SOURCE)[0].support).toBe("supported");
  });

  it("does not judge stock phrases with few content words", () => {
    expect(matchSentences("Review in clinic.", SOURCE)[0].support).toBe("neutral");
  });

  it("returns only unsupported sentences from the filter, and an empty source supports nothing", () => {
    const text = "Headache for two days. Diagnosed with chronic migraine disorder.";
    const flagged = unsupportedSentences(text, SOURCE);
    expect(flagged.map((s) => s.text)).toEqual(["Diagnosed with chronic migraine disorder."]);
    expect(unsupportedSentences("Headache for two days with nausea.", "")[0].support).toBe("unsupported");
  });

  it("normalises the key for a resolved sentence", () => {
    expect(sentenceKey("  Some   Text. ")).toBe("some text.");
  });
});
