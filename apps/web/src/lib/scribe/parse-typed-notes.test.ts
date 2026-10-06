import { parseTypedNotes } from "./parse-typed-notes";

describe("parseTypedNotes", () => {
  it("tags speakers from prefixes and keeps the text as written", () => {
    const segs = parseTypedNotes("Doctor: What brings you in?\nPatient: Headache for two weeks.\nDr - BP 164/98");
    expect(segs.map((s) => [s.speaker, s.text])).toEqual([
      ["clinician", "What brings you in?"],
      ["patient", "Headache for two weeks."],
      ["clinician", "BP 164/98"],
    ]);
    expect(segs.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it("joins an unprefixed line onto the previous segment and tags a leading one unknown", () => {
    const segs = parseTypedNotes("52M, headache x2/52\nPatient: it is worse in the evening\nand sometimes my vision blurs");
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ speaker: "unknown", text: "52M, headache x2/52" });
    expect(segs[1]?.text).toBe("it is worse in the evening and sometimes my vision blurs");
  });

  it("handles Windows line endings and blank lines, and drops empty segments", () => {
    expect(parseTypedNotes("Patient: hello\r\n\r\nDoctor:   \r\nDoctor: hi")).toHaveLength(2);
  });

  it("splits a very long segment so none exceeds the function's limit", () => {
    const segs = parseTypedNotes("Patient: " + "a".repeat(4500));
    expect(segs.length).toBe(3);
    expect(Math.max(...segs.map((s) => s.text.length))).toBeLessThanOrEqual(2000);
    expect(segs.map((s) => s.text).join("")).toBe("a".repeat(4500));
  });

  it("returns nothing for blank input", () => {
    expect(parseTypedNotes("  \n \n")).toEqual([]);
  });

  it("does not read a hyphenated word as a speaker label", () => {
    const segs = parseTypedNotes("Doctor: Patient-reported BP 150/90 at home\nDr-led review planned\nPatient - agrees");
    expect(segs.map((s) => [s.speaker, s.text])).toEqual([
      ["clinician", "Patient-reported BP 150/90 at home Dr-led review planned"],
      ["patient", "agrees"],
    ]);
  });
});
