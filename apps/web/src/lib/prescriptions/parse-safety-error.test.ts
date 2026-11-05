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

describe("isPrescribingSwitchedOff (T2-11)", () => {
  const { isPrescribingSwitchedOff, PRESCRIBING_SWITCHED_OFF_MESSAGE } = jest.requireActual("./parse-safety-error") as typeof import("./parse-safety-error");
  it("recognises the master-off refusal and nothing else", () => {
    expect(isPrescribingSwitchedOff({ code: "55000", message: "prescribing_guard_off" })).toBe(true);
    expect(isPrescribingSwitchedOff({ code: "42501", message: "Not authorised to prescribe for this patient" })).toBe(false);
    expect(isPrescribingSwitchedOff(null)).toBe(false);
    expect(isPrescribingSwitchedOff("prescribing_guard_off")).toBe(false);
  });
  it("tells the signer who opens it, in plain words", () => {
    expect(PRESCRIBING_SWITCHED_OFF_MESSAGE).toMatch(/Chief Medical Officer/);
    expect(PRESCRIBING_SWITCHED_OFF_MESSAGE).not.toMatch(/\u2014|_/);
  });
});

describe("T2-11b: interactions, class allergy, unavailable check and licence", () => {
  const m = jest.requireActual("./parse-safety-error") as typeof import("./parse-safety-error");
  const blockedHint = JSON.stringify([
    { code: "interaction", source: "dataset", severity: "contraindicated", title: "Dual blockade of the renin-angiotensin system", with: "Lisinopril", blocking: true },
    { code: "interaction", source: "rule_set", severity: "contraindicated", title: null, with: "Lisinopril", blocking: true },
  ]);

  it("a contraindicated pair is a hard stop that names the other medicine, once per title", () => {
    expect(m.parseSafetyError({ code: "P0001", details: "SAFETY_BLOCKED", hint: blockedHint, message: "x" })).toEqual({
      kind: "blocked",
      interactions: [
        { withDrug: "Lisinopril", title: "Dual blockade of the renin-angiotensin system" },
        { withDrug: "Lisinopril", title: null },
      ],
    });
  });

  it("a controlled medicine keeps its own stop even when an interaction is also present", () => {
    const hint = JSON.stringify([{ code: "controlled_medicine", blocking: true }, { code: "interaction", with: "X", blocking: true }]);
    expect(m.parseSafetyError({ code: "P0001", details: "SAFETY_BLOCKED", hint, message: "x" })).toEqual({ kind: "blocked" });
  });

  it("reads a caution interaction and a class allergy as findings that need a reason", () => {
    const hint = JSON.stringify([
      { code: "interaction", severity: "caution", title: "Kidney injury risk", with: "Lisinopril" },
      { code: "allergy_class_match", allergen: "Penicillin", drug_class: "penicillin" },
    ]);
    const parsed = m.parseSafetyError({ code: "P0001", details: "SAFETY_FINDINGS", hint, message: "x" });
    expect(parsed).toEqual({
      kind: "findings",
      findings: [
        { code: "interaction", withDrug: "Lisinopril", severity: "caution", title: "Kidney injury risk" },
        { code: "allergy_class_match", allergen: "Penicillin", drugClass: "penicillin" },
      ],
    });
    if (parsed?.kind !== "findings") throw new Error("expected findings");
    expect(m.needsOverrideReason(parsed)).toBe(true);
    expect(m.describeFinding(parsed.findings[0]!)).toMatch(/interacts with Lisinopril/);
    expect(m.describeFinding(parsed.findings[1]!)).toMatch(/allergy to Penicillin.*same group \(penicillin\)/);
  });

  it("names the unavailable check and the licence refusal plainly, and nothing else", () => {
    expect(m.describePrescribingRefusal({ code: "P0001", details: "SAFETY_CHECK_UNAVAILABLE", message: "x" })).toBe(m.INTERACTION_CHECK_UNAVAILABLE_MESSAGE);
    expect(m.describePrescribingRefusal({ code: "42501", message: "prescriber_licence_not_verified" })).toBe(m.PRESCRIBER_LICENCE_MESSAGE);
    expect(m.describePrescribingRefusal({ code: "55000", message: "prescribing_guard_off" })).toBe(m.PRESCRIBING_SWITCHED_OFF_MESSAGE);
    expect(m.describePrescribingRefusal({ code: "42501", message: "Not authorised to prescribe for this patient" })).toBeNull();
    for (const text of [m.INTERACTION_CHECK_UNAVAILABLE_MESSAGE, m.PRESCRIBER_LICENCE_MESSAGE]) expect(text).not.toMatch(/\u2014|_/);
  });
});
