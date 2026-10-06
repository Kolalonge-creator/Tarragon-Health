import {
  describeFinding,
  isSafetyResubmitReady,
  needsAllergyConfirmation,
  needsOverrideReason,
  parseSafetyError,
} from "./parse-safety-error";

const findingsError = (hint: string, key: "details" | "detail" = "details") => ({
  code: "P0001",
  message: "A safety check needs your attention before this can be signed.",
  [key]: "SAFETY_FINDINGS",
  hint,
});

describe("parseSafetyError", () => {
  it("reads the three finding codes from the hint", () => {
    const parsed = parseSafetyError(
      findingsError(JSON.stringify([{ code: "allergy_match", allergen: "Penicillin" }, { code: "allergies_unrecorded" }, { code: "duplicate_active" }]))
    );
    expect(parsed).toEqual({
      kind: "findings",
      findings: [{ code: "allergy_match", allergen: "Penicillin" }, { code: "allergies_unrecorded" }, { code: "duplicate_active" }],
    });
  });

  it("accepts a serialised copy that uses `detail`", () => {
    const parsed = parseSafetyError(findingsError(JSON.stringify([{ code: "duplicate_active" }]), "detail"));
    expect(parsed?.kind).toBe("findings");
  });

  it("recognises a controlled medicine as blocked", () => {
    expect(parseSafetyError({ code: "P0001", details: "SAFETY_BLOCKED", hint: "[]", message: "x" })).toEqual({ kind: "blocked" });
  });

  it("returns null for any other error", () => {
    expect(parseSafetyError(new Error("boom"))).toBeNull();
    expect(parseSafetyError({ code: "42501", details: null, message: "not authorised" })).toBeNull();
    expect(parseSafetyError(null)).toBeNull();
    expect(parseSafetyError("SAFETY_FINDINGS")).toBeNull();
  });

  it("fails closed on an unreadable hint: still a findings error that needs a reason", () => {
    for (const hint of ["not json", "", "{}", "[]"]) {
      const parsed = parseSafetyError(findingsError(hint));
      expect(parsed?.kind).toBe("findings");
      expect(parsed && needsOverrideReason(parsed)).toBe(true);
    }
  });

  it("keeps an unrecognised code as an unknown finding that needs a reason", () => {
    const parsed = parseSafetyError(findingsError(JSON.stringify([{ code: "dose_range" }, "x", { code: "allergy_match" }])));
    expect(parsed).toEqual({
      kind: "findings",
      findings: [
        { code: "unknown", raw: "dose_range" },
        { code: "unknown", raw: "unrecognised" },
        { code: "unknown", raw: "allergy_match" },
      ],
    });
  });
});

describe("describeFinding", () => {
  it("names the allergen, the empty list and the duplicate in plain words", () => {
    expect(describeFinding({ code: "allergy_match", allergen: "Penicillin" })).toContain("Penicillin");
    expect(describeFinding({ code: "allergies_unrecorded" })).toMatch(/allergy list is empty/);
    expect(describeFinding({ code: "duplicate_active" })).toMatch(/already taking/);
    expect(describeFinding({ code: "unknown", raw: "x" })).toMatch(/needing your attention/);
  });

  it("never uses an em dash", () => {
    const all = [
      describeFinding({ code: "allergy_match", allergen: "A" }),
      describeFinding({ code: "allergies_unrecorded" }),
      describeFinding({ code: "duplicate_active" }),
      describeFinding({ code: "unknown", raw: "x" }),
    ];
    for (const text of all) expect(text).not.toContain("—");
  });
});

describe("isSafetyResubmitReady", () => {
  const empty = parseSafetyError(findingsError(JSON.stringify([{ code: "allergies_unrecorded" }])))!;
  const match = parseSafetyError(findingsError(JSON.stringify([{ code: "allergy_match", allergen: "Penicillin" }])))!;
  const both = parseSafetyError(findingsError(JSON.stringify([{ code: "allergies_unrecorded" }, { code: "duplicate_active" }])))!;

  it("an empty allergy list needs the confirmation and nothing else", () => {
    expect(needsAllergyConfirmation(empty)).toBe(true);
    expect(needsOverrideReason(empty)).toBe(false);
    expect(isSafetyResubmitReady(empty, { allergiesConfirmed: false, overrideReason: "" })).toBe(false);
    expect(isSafetyResubmitReady(empty, { allergiesConfirmed: true, overrideReason: "" })).toBe(true);
  });

  it("an allergy match needs a reason, and a blank or spaces-only reason does not count", () => {
    expect(isSafetyResubmitReady(match, { allergiesConfirmed: true, overrideReason: "   " })).toBe(false);
    expect(isSafetyResubmitReady(match, { allergiesConfirmed: false, overrideReason: "Tolerated before, patient informed" })).toBe(true);
  });

  it("mixed findings need both", () => {
    expect(isSafetyResubmitReady(both, { allergiesConfirmed: true, overrideReason: "" })).toBe(false);
    expect(isSafetyResubmitReady(both, { allergiesConfirmed: false, overrideReason: "ok" })).toBe(false);
    expect(isSafetyResubmitReady(both, { allergiesConfirmed: true, overrideReason: "ok" })).toBe(true);
  });

  it("a blocked medicine is never ready, whatever is supplied", () => {
    expect(isSafetyResubmitReady({ kind: "blocked" }, { allergiesConfirmed: true, overrideReason: "please" })).toBe(false);
  });
});
