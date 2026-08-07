import {
  QUALITATIVE_CATALOGUE,
  convertToCanonical,
  extractableCodes,
  isQualitativeCode,
  resolveAnalyteCode,
  resolveQualitativeValue,
} from "./analyte-catalogue";
import {
  checkAgainstPrintedRange,
  checkConsistency,
  parsePrintedRange,
  type QcFlag,
} from "./qc";
import {
  codesWithoutInterpretation,
  estimateGfr,
  interpretReading,
  worstStatusOf,
} from "./reference-ranges";
import { labNameKey, layoutFingerprint, hintsFromConfirmedRows, mergeHints } from "./corpus";

/**
 * These cover the half of a Nigerian lab report the engine could not read
 * before: the non-numeric results, and the checks that catch a confident
 * misreading of the numeric ones.
 */

describe("qualitative analytes", () => {
  it("resolves the row labels Nigerian reports actually print", () => {
    expect(resolveAnalyteCode("Genotype")).toBe("genotype");
    expect(resolveAnalyteCode("HB GENOTYPE")).toBe("genotype");
    expect(resolveAnalyteCode("Haemoglobin Electrophoresis")).toBe("genotype");
    expect(resolveAnalyteCode("Malaria Parasite")).toBe("malaria_parasite");
    expect(resolveAnalyteCode("M.P.")).toBe("malaria_parasite");
    expect(resolveAnalyteCode("Blood Film for MP")).toBe("malaria_parasite");
    expect(resolveAnalyteCode("HBsAg")).toBe("hepatitis_b_surface_antigen");
    expect(resolveAnalyteCode("Blood Group")).toBe("blood_group");
  });

  it("does not let a genotype row resolve to haemoglobin", () => {
    // "Haemoglobin" and "Haemoglobin Genotype" are one word apart and mean
    // entirely different things. Longest-alias-wins is what keeps them apart.
    expect(resolveAnalyteCode("Haemoglobin")).toBe("haemoglobin");
    expect(resolveAnalyteCode("Haemoglobin Genotype")).toBe("genotype");
  });

  it("folds the many ways a positive result is printed", () => {
    for (const printed of ["Positive", "POSITIVE", "+ve", "Reactive", "Detected", "Seen"]) {
      expect(resolveQualitativeValue("malaria_parasite", printed)).toBe("positive");
    }
    for (const printed of ["Negative", "-ve", "Not Seen", "NIL", "Non-Reactive", "Absent"]) {
      expect(resolveQualitativeValue("malaria_parasite", printed)).toBe("negative");
    }
  });

  it("reads the full-sentence forms a microscopy report uses", () => {
    expect(resolveQualitativeValue("malaria_parasite", "No malaria parasite seen")).toBe("negative");
    expect(resolveQualitativeValue("malaria_parasite", "Malaria parasite seen")).toBe("positive");
  });

  it("folds genotype and blood group spellings", () => {
    expect(resolveQualitativeValue("genotype", "AA")).toBe("AA");
    expect(resolveQualitativeValue("genotype", "Hb AS")).toBe("AS");
    expect(resolveQualitativeValue("genotype", "ss")).toBe("SS");
    expect(resolveQualitativeValue("blood_group", "O Positive")).toBe("O+");
    expect(resolveQualitativeValue("blood_group", "o+")).toBe("O+");
    expect(resolveQualitativeValue("blood_group", "AB Negative")).toBe("AB-");
  });

  it("reads dipstick grades in both word and plus form", () => {
    expect(resolveQualitativeValue("urine_protein", "Trace")).toBe("trace");
    expect(resolveQualitativeValue("urine_protein", "++")).toBe("2+");
    expect(resolveQualitativeValue("urine_protein", "2+")).toBe("2+");
    expect(resolveQualitativeValue("urine_protein", "NIL")).toBe("negative");
  });

  it("refuses wording it does not know rather than guessing", () => {
    // A wrong genotype is worse than a missing one — it is a lifelong result
    // that changes family planning advice.
    expect(resolveQualitativeValue("genotype", "possible variant, see comment")).toBeNull();
    expect(resolveQualitativeValue("malaria_parasite", "scanty ring forms?")).toBeNull();
  });

  it("keeps qualitative codes out of the numeric conversion path", () => {
    // convertToCanonical must not silently accept a code with no unit at all.
    expect(convertToCanonical("genotype", 1, null).ok).toBe(false);
    expect(isQualitativeCode("genotype")).toBe(true);
    expect(isQualitativeCode("haemoglobin")).toBe(false);
  });

  it("exposes every qualitative code to the prompt vocabulary", () => {
    const codes = extractableCodes();
    for (const analyte of QUALITATIVE_CATALOGUE) {
      expect(codes).toContain(analyte.code);
    }
  });

  it("only ever produces a value the analyte declares", () => {
    for (const analyte of QUALITATIVE_CATALOGUE) {
      for (const alias of Object.keys(analyte.valueAliases)) {
        const resolved = resolveQualitativeValue(analyte.code, alias);
        if (resolved !== null) expect(analyte.values).toContain(resolved);
      }
    }
  });
});

describe("white cell and platelet units", () => {
  it("reads the per-microlitre form Nigerian analysers print", () => {
    // 5,400/µL and 5.4 x10^9/L are the same result. Refusing the first would
    // reject most of the FBCs in the country.
    expect(convertToCanonical("wbc", 5400, "/uL")).toEqual({ ok: true, value: 5.4, converted: true });
    expect(convertToCanonical("wbc", 5.4, "10^9/L")).toEqual({ ok: true, value: 5.4, converted: false });
    expect(convertToCanonical("platelets", 250000, "/mm3")).toEqual({
      ok: true,
      value: 250,
      converted: true,
    });
  });

  it("rejects a platelet count that is implausible after conversion", () => {
    // 250,000 read as 10^9/L would be 250,000 x10^9/L — outside the plausible
    // band, so the guard catches the missed conversion.
    expect(convertToCanonical("platelets", 250000, "10^9/L").ok).toBe(false);
  });
});

describe("parsePrintedRange", () => {
  it("reads the range forms real reports print", () => {
    expect(parsePrintedRange("70 - 110")).toEqual({ min: 70, max: 110 });
    expect(parsePrintedRange("70–110")).toEqual({ min: 70, max: 110 }); // en dash
    expect(parsePrintedRange("3.5 to 5.1")).toEqual({ min: 3.5, max: 5.1 });
    expect(parsePrintedRange("0.5-1.2 mg/dL")).toEqual({ min: 0.5, max: 1.2 });
    expect(parsePrintedRange("< 200")).toEqual({ min: null, max: 200 });
    expect(parsePrintedRange("up to 40")).toEqual({ min: null, max: 40 });
    expect(parsePrintedRange("> 40")).toEqual({ min: 40, max: null });
  });

  it("refuses text that is not a range at all", () => {
    expect(parsePrintedRange("Negative")).toEqual({ min: null, max: null });
    expect(parsePrintedRange("See comment")).toEqual({ min: null, max: null });
    expect(parsePrintedRange(null)).toEqual({ min: null, max: null });
  });

  it("refuses a bare single number, which does not say which side it bounds", () => {
    expect(parsePrintedRange("200")).toEqual({ min: null, max: null });
  });
});

describe("checkAgainstPrintedRange", () => {
  const base = { plausible: { min: 30, max: 800 }, label: "Total cholesterol" };

  it("says nothing when the value sits inside the lab's own range", () => {
    expect(
      checkAgainstPrintedRange({
        ...base,
        value: 180,
        reportedRange: "0 - 200",
        canonicalRange: { min: 0, max: 200 },
      }),
    ).toEqual([]);
  });

  it("flags a value the lab itself considered abnormal", () => {
    const flags = checkAgainstPrintedRange({
      ...base,
      value: 260,
      reportedRange: "0 - 200",
      canonicalRange: { min: 0, max: 200 },
    });
    expect(flags.map((f) => f.key)).toContain("outside_printed_range");
  });

  it("flags an order-of-magnitude break as a suspected unit misread", () => {
    // The classic failure: a glucose printed in mmol/L (5.5) recorded as mg/dL
    // against a printed range of 70-110. The lab's own range is the answer key.
    const flags = checkAgainstPrintedRange({
      value: 5.5,
      reportedRange: "70 - 110",
      canonicalRange: { min: 70, max: 110 },
      plausible: { min: 10, max: 1500 },
      label: "Fasting glucose",
    });
    expect(flags.map((f) => f.key)).toContain("unit_mismatch_suspected");
  });

  it("cannot catch a low-side misread when the lab printed a zero lower bound", () => {
    // Honest limit of this check. Cholesterol ranges print as "0 - 200", so a
    // 5.2 mmol/L value misrecorded as mg/dL is not distinguishable from a very
    // low real result by the range alone. The PLAUSIBILITY guard is what
    // catches this one (total cholesterol is implausible below 30), which is
    // why the two checks are layered rather than either being relied on alone.
    const flags = checkAgainstPrintedRange({
      ...base,
      value: 5.2,
      reportedRange: "0 - 200",
      canonicalRange: { min: 0, max: 200 },
    });
    expect(flags.map((f) => f.key)).not.toContain("unit_mismatch_suspected");
    expect(convertToCanonical("total_cholesterol", 5.2, "mg/dL")).toEqual({
      ok: false,
      reason: "implausible",
    });
  });

  it("does not cry unit-mismatch on a genuinely extreme result", () => {
    // An ALT of 900 against a range of 0-41 is real acute hepatitis, not a
    // misreading. Flagging it as a transcription error would train reviewers
    // to ignore the flag that matters.
    const flags = checkAgainstPrintedRange({
      value: 300,
      reportedRange: "0 - 41",
      canonicalRange: { min: 0, max: 41 },
      plausible: { min: 1, max: 20000 },
      label: "ALT",
    });
    expect(flags.map((f) => f.key)).not.toContain("unit_mismatch_suspected");
    expect(flags.map((f) => f.key)).toContain("outside_printed_range");
  });

  it("notices a reference range that belongs to a different row", () => {
    const flags = checkAgainstPrintedRange({
      value: 180,
      reportedRange: "150 - 400",
      canonicalRange: { min: 150, max: 400 },
      plausible: { min: 1, max: 25 }, // haemoglobin
      label: "Haemoglobin",
    });
    expect(flags.map((f) => f.key)).toContain("printed_range_unexpected");
  });
});

describe("checkConsistency", () => {
  const row = (code: string, value: number) => ({
    code,
    value,
    status: "ready",
    flags: [] as QcFlag[],
  });

  it("catches a PCV that disagrees with the haemoglobin", () => {
    // PCV runs at about three times the haemoglobin. 12 and 25 do not agree,
    // and on an FBC table those two rows sit adjacent.
    const rows = [row("haemoglobin", 12), row("haematocrit", 25)];
    checkConsistency(rows);
    expect(rows[0]!.flags.map((f) => f.key)).toContain("inconsistent_pcv_haemoglobin");
    expect(rows[1]!.flags.map((f) => f.key)).toContain("inconsistent_pcv_haemoglobin");
  });

  it("accepts a PCV that agrees with the haemoglobin", () => {
    const rows = [row("haemoglobin", 12), row("haematocrit", 36)];
    checkConsistency(rows);
    expect(rows[0]!.flags).toHaveLength(0);
  });

  it("catches a differential that does not sum to a hundred", () => {
    const rows = [
      row("neutrophils_pct", 60),
      row("lymphocytes_pct", 55),
      row("eosinophils_pct", 3),
      row("monocytes_pct", 5),
    ];
    checkConsistency(rows);
    expect(rows[0]!.flags.map((f) => f.key)).toContain("inconsistent_differential");
  });

  it("accepts a differential that sums correctly", () => {
    const rows = [
      row("neutrophils_pct", 55),
      row("lymphocytes_pct", 35),
      row("eosinophils_pct", 4),
      row("monocytes_pct", 5),
    ];
    checkConsistency(rows);
    expect(rows.every((r) => r.flags.length === 0)).toBe(true);
  });

  it("catches a direct bilirubin higher than the total", () => {
    const rows = [row("total_bilirubin", 0.8), row("direct_bilirubin", 1.4)];
    checkConsistency(rows);
    expect(rows[0]!.flags.map((f) => f.key)).toContain("inconsistent_bilirubin");
  });

  it("catches a lipid panel that does not obey Friedewald", () => {
    // LDL 100 + HDL 50 + TG/5 (30) = 180, against a printed total of 300.
    const rows = [
      row("total_cholesterol", 300),
      row("ldl_cholesterol", 100),
      row("hdl_cholesterol", 50),
      row("triglycerides", 150),
    ];
    checkConsistency(rows);
    expect(rows[0]!.flags.map((f) => f.key)).toContain("inconsistent_lipid_panel");
  });

  it("accepts a coherent lipid panel", () => {
    const rows = [
      row("total_cholesterol", 200),
      row("ldl_cholesterol", 120),
      row("hdl_cholesterol", 50),
      row("triglycerides", 150),
    ];
    checkConsistency(rows);
    expect(rows.every((r) => r.flags.length === 0)).toBe(true);
  });

  it("ignores rows that did not convert cleanly", () => {
    // Reasoning about a value we already rejected would produce a warning
    // about a number nobody is going to file.
    const rows = [
      { ...row("haemoglobin", 12), status: "implausible" },
      row("haematocrit", 25),
    ];
    checkConsistency(rows);
    expect(rows[1]!.flags).toHaveLength(0);
  });
});

describe("reference ranges", () => {
  const male = { sex: "male" as const, ageYears: 45 };
  const female = { sex: "female" as const, ageYears: 45 };

  it("interprets every code the catalogue can extract", () => {
    // A code with no interpretation renders as "no reference range" rather
    // than silently as normal — this asserts we never ship that gap quietly.
    expect(codesWithoutInterpretation(extractableCodes())).toEqual([]);
  });

  it("uses the ADA thresholds for HbA1c", () => {
    expect(interpretReading("hba1c", 5.4, male)?.status).toBe("normal");
    expect(interpretReading("hba1c", 6.0, male)?.status).toBe("borderline"); // prediabetes
    expect(interpretReading("hba1c", 7.5, male)?.status).toBe("abnormal");
  });

  it("uses WHO anaemia thresholds, and they differ by sex", () => {
    expect(interpretReading("haemoglobin", 12.5, male)?.status).toBe("borderline");
    expect(interpretReading("haemoglobin", 12.5, female)?.status).toBe("normal");
  });

  it("calls a haemoglobin at the transfusion threshold critical", () => {
    expect(interpretReading("haemoglobin", 6.5, male)?.status).toBe("critical");
  });

  it("calls the potassium values that need a same-day call critical", () => {
    expect(interpretReading("potassium", 4.2, male)?.status).toBe("normal");
    expect(interpretReading("potassium", 5.3, male)?.status).toBe("borderline");
    expect(interpretReading("potassium", 6.8, male)?.status).toBe("critical");
    expect(interpretReading("potassium", 2.2, male)?.status).toBe("critical");
  });

  it("treats a low HDL as the abnormal direction, with no upper flag", () => {
    expect(interpretReading("hdl_cholesterol", 35, male)?.status).toBe("abnormal");
    expect(interpretReading("hdl_cholesterol", 45, male)?.status).toBe("normal");
    expect(interpretReading("hdl_cholesterol", 45, female)?.status).toBe("abnormal");
    expect(interpretReading("hdl_cholesterol", 90, male)?.status).toBe("normal");
  });

  it("bands PSA by age", () => {
    expect(interpretReading("psa", 3.0, { sex: "male", ageYears: 45 })?.status).toBe("borderline");
    expect(interpretReading("psa", 3.0, { sex: "male", ageYears: 75 })?.status).toBe("normal");
  });

  it("treats a sickling genotype as needing review and a carrier state as not", () => {
    expect(interpretReading("genotype", "AA", male)?.status).toBe("normal");
    expect(interpretReading("genotype", "AS", male)?.status).toBe("borderline");
    expect(interpretReading("genotype", "SS", male)?.status).toBe("abnormal");
  });

  it("never calls a blood group abnormal", () => {
    for (const group of ["O+", "AB-", "A+"]) {
      expect(interpretReading("blood_group", group, male)?.status).toBe("normal");
    }
  });

  it("calls WHO hyperparasitaemia critical", () => {
    expect(interpretReading("malaria_parasitaemia", 2000, male)?.status).toBe("abnormal");
    expect(interpretReading("malaria_parasitaemia", 150000, male)?.status).toBe("critical");
  });
});

describe("estimateGfr", () => {
  it("uses the race-free CKD-EPI 2021 equation", () => {
    // A 45-year-old man with a creatinine of 1.0 mg/dL sits just under 90.
    const result = estimateGfr(1.0, { sex: "male", ageYears: 45 });
    expect(result).not.toBeNull();
    expect(result!.value).toBeGreaterThan(80);
    expect(result!.value).toBeLessThan(100);
  });

  it("stages severely reduced function as critical", () => {
    const result = estimateGfr(5.0, { sex: "male", ageYears: 60 });
    expect(result!.status).toBe("critical");
    expect(result!.stage).toMatch(/G[45]/);
  });

  it("refuses to estimate without an age and sex rather than guessing", () => {
    expect(estimateGfr(1.0, { sex: null, ageYears: 45 })).toBeNull();
    expect(estimateGfr(1.0, { sex: "male", ageYears: null })).toBeNull();
    expect(estimateGfr(1.0, { sex: "male", ageYears: 8 })).toBeNull();
  });
});

describe("worstStatusOf", () => {
  const ctx = { sex: "male" as const, ageYears: 45 };
  const ready = (code: string, value: number) => ({
    code,
    value,
    valueText: null,
    status: "ready",
  });

  it("reports the worst status and names what drove it", () => {
    const result = worstStatusOf(
      [ready("haemoglobin", 6.0), ready("hba1c", 5.2)],
      ctx,
    );
    expect(result.status).toBe("critical");
    expect(result.criticalCodes).toEqual(["haemoglobin"]);
    expect(result.reason).toContain("haemoglobin");
  });

  it("does not escalate on a reading that failed quality control", () => {
    // Escalating on a value we already rejected would raise a doctor's queue
    // on the strength of a misreading.
    const result = worstStatusOf(
      [{ code: "potassium", value: 9.9, valueText: null, status: "implausible" }],
      ctx,
    );
    expect(result.status).toBeNull();
    expect(result.criticalCodes).toEqual([]);
  });

  it("returns nothing to escalate on when everything is normal", () => {
    const result = worstStatusOf([ready("hba1c", 5.2), ready("potassium", 4.1)], ctx);
    expect(result.status).toBe("normal");
    expect(result.reason).toBeNull();
  });
});

describe("corpus identity", () => {
  it("folds a laboratory's name variants onto one key", () => {
    const keys = [
      "Synlab Nigeria Limited",
      "SYNLAB DIAGNOSTICS",
      "Synlab",
      "synlab nigeria ltd",
    ].map(labNameKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("synlab");
  });

  it("gives the same fingerprint whatever order the rows were read in", () => {
    const a = layoutFingerprint("synlab", ["Haemoglobin", "PCV", "WBC", "Platelets"]);
    const b = layoutFingerprint("synlab", ["Platelets", "WBC", "PCV", "Haemoglobin"]);
    expect(a).toBe(b);
    expect(a).not.toBeNull();
  });

  it("separates two different laboratories printing the same panel", () => {
    const a = layoutFingerprint("synlab", ["Haemoglobin", "PCV", "WBC"]);
    const b = layoutFingerprint("afriglobal", ["Haemoglobin", "PCV", "WBC"]);
    expect(a).not.toBe(b);
  });

  it("refuses to fingerprint too little to be distinctive", () => {
    expect(layoutFingerprint("synlab", ["Haemoglobin"])).toBeNull();
    expect(layoutFingerprint("synlab", [])).toBeNull();
  });

  it("builds a fingerprint from labels only, never from values", () => {
    // lab_report_templates is organisation-less so the corpus can compound
    // across every upload. That is only defensible while a row cannot identify
    // anyone, so the fingerprint must not vary with a patient's results.
    const a = layoutFingerprint("synlab", ["Haemoglobin", "PCV", "WBC"]);
    const b = layoutFingerprint("synlab", ["Haemoglobin", "PCV", "WBC"]);
    expect(a).toBe(b);
  });
});

describe("corpus hints", () => {
  it("learns a label mapping and a printed unit from mapped rows", () => {
    const hints = hintsFromConfirmedRows([
      { reportedLabel: "PACKED CELL VOL.", code: "haematocrit", unit: "%", status: "ready" },
      { reportedLabel: "Mystery row", code: null, unit: null, status: "unmapped" },
    ]);
    expect(hints.labelAliases).toEqual({ "PACKED CELL VOL.": "haematocrit" });
    expect(hints.unitDefaults).toEqual({ haematocrit: "%" });
  });

  it("never learns from a row that did not map", () => {
    const hints = hintsFromConfirmedRows([
      { reportedLabel: "Unknown assay", code: null, unit: "mg/dL", status: "unmapped" },
    ]);
    expect(hints.labelAliases).toEqual({});
  });

  it("merges new learning over old, newest winning", () => {
    const merged = mergeHints(
      { labelAliases: { OLD: "wbc" }, unitDefaults: { wbc: "/uL" } },
      { labelAliases: { NEW: "platelets" }, unitDefaults: { wbc: "10^9/L" } },
    );
    expect(merged.labelAliases).toEqual({ OLD: "wbc", NEW: "platelets" });
    expect(merged.unitDefaults).toEqual({ wbc: "10^9/L" });
  });
});
