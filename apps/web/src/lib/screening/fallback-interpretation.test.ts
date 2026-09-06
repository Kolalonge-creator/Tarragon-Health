import {
  CLINICIAN_INTERPRETATION_MARKER,
  interpretScreeningResultLocally,
  withInterpretationProvenance,
} from "./fallback-interpretation";

/**
 * The point of these tests is not "does a switch statement work" — it is that
 * the ML-unavailable path still produces a row the DB trigger
 * `private.handle_abnormal_screening_result` will act on. That trigger keys
 * off two things and nothing else: `result_status in ('abnormal','critical')`
 * and an exact-token overlap on `abnormal_flags`. So every test below asserts
 * one of those two, not prose.
 */

/** The exact arrays private.handle_abnormal_screening_result matches on
 * (verified against the live function definition, 2026-09-05). */
const TRIGGER_HYPERTENSION = ["bp", "blood_pressure", "hypertension"];
const TRIGGER_DIABETES = ["glucose", "hba1c", "diabetes"];
const TRIGGER_CANCER = ["psa", "cancer", "mammography", "cervical", "fit"];
const TRIGGER_SENSITIVE = [
  "hiv",
  "hep_b",
  "hep_c",
  "psa",
  "cancer",
  "mammography",
  "cervical",
  "fit",
];

function inferredCondition(flags: string[]): string {
  if (flags.some((f) => TRIGGER_HYPERTENSION.includes(f))) return "hypertension";
  if (flags.some((f) => TRIGGER_DIABETES.includes(f))) return "diabetes";
  if (flags.some((f) => TRIGGER_CANCER.includes(f))) return "cancer_referral";
  return "other";
}

describe("HbA1c", () => {
  it("classifies against the ADA bands", () => {
    const bands: [number, string][] = [
      [5.6, "normal"],
      [5.7, "borderline"],
      [6.4, "borderline"],
      [6.5, "abnormal"],
      [9.9, "abnormal"],
      [10, "critical"],
      [13.2, "critical"],
    ];
    for (const [value, expected] of bands) {
      const out = interpretScreeningResultLocally({
        screenTypeCode: "hba1c",
        sex: "female",
        age: 45,
        analytes: [{ code: "hba1c", value }],
      });
      expect(`${value}=${out.result_status}`).toBe(`${value}=${expected}`);
    }
  });

  it("routes a critical HbA1c to the trigger's diabetes bucket", () => {
    const out = interpretScreeningResultLocally({
      screenTypeCode: "hba1c",
      sex: "male",
      age: 52,
      analytes: [{ code: "hba1c", value: 12.4 }],
    });
    expect(out.result_status).toBe("critical");
    expect(out.abnormal_flags).toContain("hba1c");
    expect(inferredCondition(out.abnormal_flags)).toBe("diabetes");
  });

  it("accepts an IFCC mmol/mol reading and reports both units", () => {
    // 48 mmol/mol is the ADA's own published equivalent of 6.5%.
    const out = interpretScreeningResultLocally({
      screenTypeCode: "hba1c",
      sex: "male",
      age: 52,
      analytes: [{ code: "hba1c", value: 48, hba1c_unit: "mmol_mol" }],
    });
    expect(out.result_status).toBe("abnormal");
    expect(out.analyte_results[0]?.value_percent).toBe(6.5);
    expect(out.analyte_results[0]?.value_mmol_mol).toBe(48);
  });

  it("emits no flag for a normal HbA1c", () => {
    const out = interpretScreeningResultLocally({
      screenTypeCode: "hba1c",
      sex: "male",
      age: 30,
      analytes: [{ code: "hba1c", value: 5.1 }],
    });
    expect(out.result_status).toBe("normal");
    expect(out.abnormal_flags).toEqual([]);
  });
});

describe("fasting glucose (the ogtt_fpg carrier code)", () => {
  it("classifies against the ADA bands and flags 'glucose'", () => {
    const bands: [number, string][] = [
      [99, "normal"],
      [100, "borderline"],
      [126, "abnormal"],
      [250, "critical"],
    ];
    for (const [value, expected] of bands) {
      const out = interpretScreeningResultLocally({
        screenTypeCode: "ogtt_fpg",
        sex: "male",
        age: 40,
        analytes: [{ code: "fasting_glucose", value }],
      });
      expect(`${value}=${out.result_status}`).toBe(`${value}=${expected}`);
    }
    const critical = interpretScreeningResultLocally({
      screenTypeCode: "ogtt_fpg",
      sex: "male",
      age: 40,
      analytes: [{ code: "fasting_glucose", value: 320 }],
    });
    expect(inferredCondition(critical.abnormal_flags)).toBe("diabetes");
  });
});

describe("PSA", () => {
  it("uses the Oesterling age band, and 10 ng/mL is critical at any age", () => {
    const inBandFor60s = interpretScreeningResultLocally({
      screenTypeCode: "psa",
      sex: "male",
      age: 65,
      analytes: [{ code: "psa", value: 4.4 }],
    });
    expect(inBandFor60s.result_status).toBe("normal");

    const aboveBandFor60s = interpretScreeningResultLocally({
      screenTypeCode: "psa",
      sex: "male",
      age: 65,
      analytes: [{ code: "psa", value: 4.6 }],
    });
    expect(aboveBandFor60s.result_status).toBe("abnormal");

    const critical = interpretScreeningResultLocally({
      screenTypeCode: "psa",
      sex: "male",
      age: 45,
      analytes: [{ code: "psa", value: 10 }],
    });
    expect(critical.result_status).toBe("critical");
    expect(inferredCondition(critical.abnormal_flags)).toBe("cancer_referral");
    // PSA is also in the trigger's sensitive set: a positive is
    // doctor-delivered, never auto-messaged.
    expect(critical.abnormal_flags.some((f) => TRIGGER_SENSITIVE.includes(f))).toBe(true);
  });

  it("escalates rather than passing a below-40 PSA as normal", () => {
    const out = interpretScreeningResultLocally({
      screenTypeCode: "psa",
      sex: "male",
      age: 32,
      analytes: [{ code: "psa", value: 0.4 }],
    });
    expect(out.result_status).toBe("abnormal");
    expect(out.abnormal_flags).toContain("psa");
  });
});

describe("lipid panel", () => {
  it("takes the worst analyte as the overall status", () => {
    const out = interpretScreeningResultLocally({
      screenTypeCode: "lipid_panel",
      sex: "male",
      age: 55,
      analytes: [
        { code: "total_cholesterol", value: 210 }, // borderline
        { code: "hdl_cholesterol", value: 55 }, // normal for male
        { code: "ldl_cholesterol", value: 195 }, // critical
        { code: "triglycerides", value: 120 }, // normal
      ],
    });
    expect(out.result_status).toBe("critical");
  });

  it("applies the sex-specific HDL cut-off", () => {
    const male = interpretScreeningResultLocally({
      screenTypeCode: "lipid_panel",
      sex: "male",
      age: 50,
      analytes: [{ code: "hdl_cholesterol", value: 45 }],
    });
    const female = interpretScreeningResultLocally({
      screenTypeCode: "lipid_panel",
      sex: "female",
      age: 50,
      analytes: [{ code: "hdl_cholesterol", value: 45 }],
    });
    expect(male.result_status).toBe("normal");
    expect(female.result_status).toBe("abnormal");
  });

  it("emits no lipid flag, so an abnormal lipid falls to the trigger's 'other' bucket", () => {
    // Deliberate: the trigger has no dyslipidaemia condition to route to. The
    // result still escalates on result_status alone.
    const out = interpretScreeningResultLocally({
      screenTypeCode: "lipid_panel",
      sex: "male",
      age: 55,
      analytes: [{ code: "ldl_cholesterol", value: 195 }],
    });
    expect(out.abnormal_flags).toEqual([]);
    expect(inferredCondition(out.abnormal_flags)).toBe("other");
    expect(out.result_status).toBe("critical");
  });
});

describe("qualitative screens", () => {
  it("makes a positive abnormal and tags the sensitive flag", () => {
    for (const code of ["hiv", "hep_b", "hep_c"]) {
      const out = interpretScreeningResultLocally({
        screenTypeCode: code,
        sex: "female",
        age: 34,
        qualitativeResult: "positive",
      });
      expect(`${code}=${out.result_status}`).toBe(`${code}=abnormal`);
      expect(out.abnormal_flags).toContain(code);
      expect(out.abnormal_flags.some((f) => TRIGGER_SENSITIVE.includes(f))).toBe(true);
    }
  });

  it("makes a negative normal and raises nothing", () => {
    const out = interpretScreeningResultLocally({
      screenTypeCode: "hiv",
      sex: "female",
      age: 34,
      qualitativeResult: "negative",
    });
    expect(out.result_status).toBe("normal");
    expect(out.abnormal_flags).toEqual([]);
  });

  it("has no flag token for tb_screen or malaria_rdt, so they fall to 'other'", () => {
    const out = interpretScreeningResultLocally({
      screenTypeCode: "tb_screen",
      sex: "male",
      age: 40,
      qualitativeResult: "positive",
    });
    expect(out.result_status).toBe("abnormal");
    expect(inferredCondition(out.abnormal_flags)).toBe("other");
  });
});

describe("genotype and blood group", () => {
  it("classifies sickle cell genotypes", () => {
    const cases: [string, string][] = [
      ["AA", "normal"],
      ["as", "borderline"],
      ["SS", "abnormal"],
      ["SC", "abnormal"],
    ];
    for (const [genotype, expected] of cases) {
      const out = interpretScreeningResultLocally({
        screenTypeCode: "sickle_cell_genotype",
        sex: "male",
        age: 20,
        genotype,
      });
      expect(`${genotype}=${out.result_status}`).toBe(`${genotype}=${expected}`);
    }
  });

  it("escalates an unrecognised genotype rather than passing it as normal", () => {
    const out = interpretScreeningResultLocally({
      screenTypeCode: "sickle_cell_genotype",
      sex: "male",
      age: 20,
      genotype: "ZZ",
    });
    expect(out.result_status).toBe("abnormal");
  });

  it("never runs a blood group through the sickle-cell classifier", () => {
    // O+ is not a sickle-cell genotype; classifying it would flag every
    // blood-group result as escalation-worthy.
    const out = interpretScreeningResultLocally({
      screenTypeCode: "blood_group",
      sex: "female",
      age: 28,
      genotype: "O+",
    });
    expect(out.result_status).toBe("normal");
    expect(out.summary).toContain("O+");
  });
});

describe("procedural screens", () => {
  it("records the clinician's own status verbatim", () => {
    for (const status of ["normal", "borderline", "abnormal", "critical"] as const) {
      const out = interpretScreeningResultLocally({
        screenTypeCode: "mammography",
        sex: "female",
        age: 52,
        proceduralStatus: status,
      });
      expect(`${status}=${out.result_status}`).toBe(`${status}=${status}`);
    }
  });

  it("routes an abnormal mammography/cervical/FIT to cancer_referral", () => {
    const expected: [string, string][] = [
      ["mammography", "mammography"],
      ["cervical_smear", "cervical"],
      ["fit", "fit"],
    ];
    for (const [code, flag] of expected) {
      const out = interpretScreeningResultLocally({
        screenTypeCode: code,
        sex: "female",
        age: 52,
        proceduralStatus: "abnormal",
      });
      expect(out.abnormal_flags).toContain(flag);
      expect(inferredCondition(out.abnormal_flags)).toBe("cancer_referral");
    }
  });

  it("raises nothing for a normal procedural screen", () => {
    const out = interpretScreeningResultLocally({
      screenTypeCode: "colonoscopy",
      sex: "male",
      age: 60,
      proceduralStatus: "normal",
    });
    expect(out.result_status).toBe("normal");
    expect(out.abnormal_flags).toEqual([]);
  });
});

describe("provenance", () => {
  it("marks a clinician-sourced interpretation and leaves an ML one alone", () => {
    expect(withInterpretationProvenance("HbA1c 12.4 (critical).", "ml")).toBe(
      "HbA1c 12.4 (critical)."
    );
    expect(withInterpretationProvenance("HbA1c 12.4 (critical).", "clinician")).toBe(
      `HbA1c 12.4 (critical). ${CLINICIAN_INTERPRETATION_MARKER}`
    );
    expect(withInterpretationProvenance("", "clinician")).toBe(CLINICIAN_INTERPRETATION_MARKER);
  });
});

describe("input contract", () => {
  it("throws only when there is genuinely nothing to interpret", () => {
    expect(() =>
      interpretScreeningResultLocally({ screenTypeCode: "hba1c", sex: "male", age: 40 })
    ).toThrow(/at least one of/);
  });
});
