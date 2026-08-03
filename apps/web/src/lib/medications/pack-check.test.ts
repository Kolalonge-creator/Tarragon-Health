import {
  checkPackAgainstPrescription,
  drugNamesMatch,
  parseStrength,
  strengthsMatch,
} from "./pack-check";

describe("parseStrength", () => {
  it("reads the strengths printed on real packs", () => {
    expect(parseStrength("10mg")).toEqual({ value: 10, unit: "mg" });
    expect(parseStrength("500 mg")).toEqual({ value: 500, unit: "mg" });
    expect(parseStrength("1 g")).toEqual({ value: 1, unit: "g" });
    expect(parseStrength("125mcg")).toEqual({ value: 125, unit: "mcg" });
    expect(parseStrength("100 IU")).toEqual({ value: 100, unit: "iu" });
  });

  it("normalises microgram spellings", () => {
    expect(parseStrength("50µg")).toEqual({ value: 50, unit: "mcg" });
    expect(parseStrength("50ug")).toEqual({ value: 50, unit: "mcg" });
  });

  it("takes the drug amount from a per-volume strength, not the vehicle", () => {
    expect(parseStrength("5mg/5ml")).toEqual({ value: 5, unit: "mg" });
    expect(parseStrength("250mg/5ml")).toEqual({ value: 250, unit: "mg" });
  });

  it("returns null when there is no strength to read", () => {
    expect(parseStrength("one tablet daily")).toBeNull();
    expect(parseStrength("")).toBeNull();
    expect(parseStrength(null)).toBeNull();
  });
});

describe("strengthsMatch", () => {
  it("compares across units in the same family", () => {
    expect(strengthsMatch(parseStrength("1g"), parseStrength("1000mg"))).toBe(true);
    expect(strengthsMatch(parseStrength("500mcg"), parseStrength("0.5mg"))).toBe(true);
  });

  it("does not match across different families", () => {
    // 5 mg and 5 ml are not the same thing, and treating them as equal would be
    // the exact class of error this feature exists to catch.
    expect(strengthsMatch(parseStrength("5mg"), parseStrength("5ml"))).toBe(false);
  });

  it("does not match different amounts", () => {
    expect(strengthsMatch(parseStrength("5mg"), parseStrength("10mg"))).toBe(false);
  });

  it("never matches when either side is unknown", () => {
    expect(strengthsMatch(null, parseStrength("10mg"))).toBe(false);
    expect(strengthsMatch(parseStrength("10mg"), null)).toBe(false);
  });
});

describe("drugNamesMatch", () => {
  it("matches the same drug written differently", () => {
    expect(drugNamesMatch("Amlodipine Tablets", "Amlodipine")).toBe(true);
    expect(drugNamesMatch("METFORMIN HCL", "Metformin")).toBe(true);
    expect(drugNamesMatch("Lisinopril 10mg tablets", "Lisinopril")).toBe(true);
  });

  it("ignores formulation suffixes that are not part of the drug identity", () => {
    expect(drugNamesMatch("Gliclazide MR", "Gliclazide")).toBe(true);
  });

  it("does not match two genuinely different drugs", () => {
    expect(drugNamesMatch("Amlodipine", "Atorvastatin")).toBe(false);
    expect(drugNamesMatch("Metformin", "Methotrexate")).toBe(false);
  });

  it("handles empty input without claiming a match", () => {
    expect(drugNamesMatch("", "Amlodipine")).toBe(false);
    expect(drugNamesMatch("Amlodipine", "")).toBe(false);
  });
});

describe("checkPackAgainstPrescription", () => {
  const prescribed = [
    { id: "m1", drugName: "Amlodipine", dose: "10mg" },
    { id: "m2", drugName: "Metformin", dose: "500mg" },
    { id: "m3", drugName: "Atorvastatin", dose: null },
  ];

  it("confirms a pack that matches the prescription", () => {
    const result = checkPackAgainstPrescription(
      { drugName: "Amlodipine Tablets", strength: "10mg" },
      prescribed,
    );
    expect(result.verdict).toBe("matches_prescription");
    expect(result.matchedMedicationId).toBe("m1");
  });

  it("catches the case this feature exists for — right drug, wrong strength", () => {
    const result = checkPackAgainstPrescription(
      { drugName: "Amlodipine", strength: "5mg" },
      prescribed,
    );
    expect(result.verdict).toBe("strength_differs");
    expect(result.packStrength).toEqual({ value: 5, unit: "mg" });
    expect(result.prescribedStrength).toEqual({ value: 10, unit: "mg" });
  });

  it("says so plainly when the medicine is not on the patient's list", () => {
    const result = checkPackAgainstPrescription(
      { drugName: "Ciprofloxacin", strength: "500mg" },
      prescribed,
    );
    expect(result.verdict).toBe("not_on_your_list");
    expect(result.matchedMedicationId).toBeNull();
  });

  it("does not claim a strength mismatch when the prescription records no dose", () => {
    // Claiming "this is the wrong strength" against an unknown prescribed dose
    // would be a fabricated alarm about a correct medicine.
    const result = checkPackAgainstPrescription(
      { drugName: "Atorvastatin", strength: "20mg" },
      prescribed,
    );
    expect(result.verdict).toBe("strength_unknown");
    expect(result.matchedMedicationId).toBe("m3");
  });

  it("returns unreadable rather than guessing when nothing could be read", () => {
    expect(checkPackAgainstPrescription({ drugName: null, strength: null }, prescribed).verdict).toBe(
      "unreadable",
    );
    expect(checkPackAgainstPrescription({ drugName: "  ", strength: "10mg" }, prescribed).verdict).toBe(
      "unreadable",
    );
  });

  it("handles a patient with no medicines on file", () => {
    const result = checkPackAgainstPrescription({ drugName: "Amlodipine", strength: "10mg" }, []);
    expect(result.verdict).toBe("not_on_your_list");
  });

  it("never returns a verdict about authenticity", () => {
    // The type itself forbids it, but assert on the values so anyone widening
    // the union has to come past this test.
    const verdicts = [
      checkPackAgainstPrescription({ drugName: "Amlodipine", strength: "10mg" }, prescribed).verdict,
      checkPackAgainstPrescription({ drugName: "Amlodipine", strength: "5mg" }, prescribed).verdict,
      checkPackAgainstPrescription({ drugName: "Unknown", strength: "1mg" }, prescribed).verdict,
    ];
    for (const v of verdicts) {
      expect(v).not.toMatch(/genuine|authentic|fake|counterfeit/i);
    }
  });
});
