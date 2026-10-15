import { CUFF_KEY, GRADE_KEY, explainerSchema, parseContext, patientTriageRowSchema, readingLine, wordingKeys } from "./explainer";
import { en } from "@tarragon/i18n";

describe("wordingKeys", () => {
  it("maps an explanation code to the approved catalogue keys", () => {
    expect(wordingKeys("TRI-001")).toEqual({ title: "triage.tri_001.title", body: "triage.tri_001.body" });
    expect(wordingKeys("EMG-001L")).toEqual({ title: "triage.emg_001l.title", body: "triage.emg_001l.body" });
  });
  it("is null for no code or a code with no wording, never a made-up key", () => {
    expect(wordingKeys(null)).toBeNull();
    expect(wordingKeys("TRI-999")).toBeNull();
    expect(wordingKeys("")).toBeNull();
  });
  it("every key it can return exists in English", () => {
    for (const code of ["EMG-001", "TRI-001", "TRI-002", "TRI-003", "TRI-005", "TRI-006", "TRI-007", "TRI-008"]) {
      const k = wordingKeys(code);
      expect(k && en[k.title]).toBeTruthy();
      expect(k && en[k.body]).toBeTruthy();
    }
    for (const k of [...Object.values(GRADE_KEY), ...Object.values(CUFF_KEY)]) expect(en[k]).toBeTruthy();
  });
});

describe("parseContext and readingLine", () => {
  it("reads a reading, cuff and symptoms; ignores extra fields", () => {
    const c = parseContext({ reading: { systolic: 152, diastolic: 96, takenAt: "x" }, cuffType: "wrist", symptoms: ["dizziness"], future: 1 });
    expect(c && readingLine(c)).toBe("152/96 mmHg");
    expect(c?.cuffType).toBe("wrist");
  });
  it("a silence trigger has no reading line; a glucose value is shown plain", () => {
    expect(readingLine(parseContext({ type: "silence", lastReadingAt: null, sinceAt: "2026-09-01T00:00:00Z" })!)).toBeNull();
    expect(readingLine(parseContext({ reading: { value: 3.4 } })!)).toBe("3.4");
  });
  it("a context of the wrong shape is null, not guessed at", () => {
    expect(parseContext("nope")).toBeNull();
    expect(parseContext({ cuffType: "ankle" })).toBeNull();
    expect(parseContext(null)).toBeNull();
  });
});

describe("schemas", () => {
  it("the explainer accepts the three statuses the function returns and refuses anything else", () => {
    expect(explainerSchema.safeParse({ status: "denied" }).success).toBe(true);
    expect(explainerSchema.safeParse({ status: "none" }).success).toBe(true);
    expect(explainerSchema.safeParse({ status: "ok" }).success).toBe(false);
    expect(explainerSchema.safeParse({ status: "weird" }).success).toBe(false);
  });
  it("a patient row needs a known grade", () => {
    expect(patientTriageRowSchema.safeParse({ id: "a", grade: "blue", explanation_key: null, created_at: "x" }).success).toBe(false);
    expect(patientTriageRowSchema.safeParse({ id: "a", grade: "red", explanation_key: "EMG-001", created_at: "x" }).success).toBe(true);
  });
});
