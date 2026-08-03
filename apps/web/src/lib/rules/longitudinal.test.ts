import {
  analyseRecord,
  analyseSeries,
  describeForClinician,
  describeForPatient,
  headlineFinding,
} from "./longitudinal";

/** Build a series n months apart, oldest first. */
function series(values: number[], startIso = "2025-01-15T00:00:00Z") {
  const start = new Date(startIso);
  return values.map((value, i) => {
    const d = new Date(start);
    d.setMonth(d.getMonth() + i * 4);
    return { value, takenAt: d.toISOString() };
  });
}

describe("analyseSeries", () => {
  it("finds the sentence this whole engine exists for", () => {
    // Creatinine rising at three consecutive checks.
    const finding = analyseSeries("creatinine", series([0.9, 1.1, 1.4]), { sex: "male" })!;
    expect(finding.direction).toBe("rising");
    expect(finding.consecutiveCount).toBe(3);
    expect(finding.percentChange).toBeCloseTo(55.6, 0);
    expect(describeForPatient(finding)).toMatch(/gone up at 3 checks in a row/i);
  });

  it("needs at least three points — two is not a trend", () => {
    expect(analyseSeries("creatinine", series([0.9, 1.4]), { sex: "male" })).toBeNull();
  });

  it("anchors on the LATEST reading, so a corrected old rise is not reported", () => {
    // Rose for three checks, then came back down and stayed down. What matters
    // now is the fall, not the historical rise.
    const finding = analyseSeries("creatinine", series([0.9, 1.2, 1.5, 1.1, 0.9]), {
      sex: "male",
    })!;
    expect(finding.direction).toBe("falling");
    expect(finding.consecutiveCount).toBe(3);
    expect(finding.latestValue).toBe(0.9);
  });

  it("stops the run at the first reading that breaks direction", () => {
    // Only the last three are consistently rising.
    const finding = analyseSeries("creatinine", series([1.4, 0.8, 1.0, 1.2, 1.5]), {
      sex: "male",
    })!;
    expect(finding.consecutiveCount).toBe(4);
    expect(finding.firstValue).toBe(0.8);
  });

  it("classifies a small consistent drift as noise, not a trend", () => {
    // Three rises, but only ~4% overall — well inside repeat-test variation.
    const finding = analyseSeries("creatinine", series([1.0, 1.02, 1.04]), { sex: "male" })!;
    expect(finding.direction).toBe("rising");
    expect(finding.significance).toBe("noise");
  });

  it("calls a real movement inside the range 'notable', not alarming", () => {
    const finding = analyseSeries("creatinine", series([0.6, 0.75, 0.95]), { sex: "male" })!;
    expect(finding.significance).toBe("notable");
    expect(finding.latestOutsideRange).toBe(false);
    expect(describeForPatient(finding)).toMatch(/still within the range/i);
    expect(describeForPatient(finding)).not.toMatch(/concern/i);
  });

  it("calls it 'outside_range' once the latest value leaves the usual band", () => {
    const finding = analyseSeries("creatinine", series([1.0, 1.3, 1.7]), { sex: "male" })!;
    expect(finding.significance).toBe("outside_range");
    expect(finding.latestOutsideRange).toBe(true);
    expect(describeForPatient(finding)).toMatch(/outside the range/i);
  });

  it("uses the sex-specific band where one exists", () => {
    // 1.2 mg/dL is inside the male band (0.7-1.3) and outside the female one.
    const male = analyseSeries("creatinine", series([0.8, 1.0, 1.2]), { sex: "male" })!;
    const female = analyseSeries("creatinine", series([0.8, 1.0, 1.2]), { sex: "female" })!;
    expect(male.latestOutsideRange).toBe(false);
    expect(female.latestOutsideRange).toBe(true);
  });

  it("applies a per-analyte noise threshold — 5% is noise for creatinine but real for HbA1c", () => {
    const creatinine = analyseSeries("creatinine", series([1.0, 1.03, 1.06]), { sex: "male" })!;
    expect(creatinine.significance).toBe("noise");

    const hba1c = analyseSeries("hba1c", series([6.0, 6.2, 6.4]))!;
    expect(hba1c.significance).not.toBe("noise");
  });

  it("returns null for a flat latest reading and for an unknown analyte", () => {
    expect(analyseSeries("creatinine", series([1.0, 1.2, 1.2]), { sex: "male" })).toBeNull();
    expect(analyseSeries("not_a_real_analyte", series([1, 2, 3]))).toBeNull();
  });

  it("sorts unordered input by date rather than trusting array order", () => {
    const unordered = [
      { value: 1.4, takenAt: "2025-09-15T00:00:00Z" },
      { value: 0.9, takenAt: "2025-01-15T00:00:00Z" },
      { value: 1.1, takenAt: "2025-05-15T00:00:00Z" },
    ];
    const finding = analyseSeries("creatinine", unordered, { sex: "male" })!;
    expect(finding.firstValue).toBe(0.9);
    expect(finding.latestValue).toBe(1.4);
    expect(finding.direction).toBe("rising");
  });

  it("ignores malformed points rather than throwing", () => {
    const messy = [
      ...series([0.9, 1.1, 1.4]),
      { value: Number.NaN, takenAt: "2025-11-01T00:00:00Z" },
      { value: 2.0, takenAt: "not-a-date" },
    ];
    const finding = analyseSeries("creatinine", messy, { sex: "male" })!;
    expect(finding.latestValue).toBe(1.4);
  });
});

describe("analyseRecord", () => {
  const readings = [
    ...series([0.9, 1.1, 1.4]).map((p) => ({ ...p, code: "creatinine" })),
    ...series([6.0, 6.4, 6.9]).map((p) => ({ ...p, code: "hba1c" })),
    // Noise — must be dropped, not merely ranked last.
    ...series([1.0, 1.01, 1.02]).map((p) => ({ ...p, code: "albumin" })),
  ];

  it("drops noise-level findings entirely rather than leaving them to the caller", () => {
    const findings = analyseRecord(readings, { sex: "male" });
    expect(findings.some((f) => f.code === "albumin")).toBe(false);
    expect(findings.some((f) => f.code === "creatinine")).toBe(true);
  });

  it("ranks out-of-range findings above in-range ones", () => {
    const findings = analyseRecord(readings, { sex: "male" });
    expect(findings[0].significance).toBe("outside_range");
  });

  it("returns the single most important thing as a headline", () => {
    const findings = analyseRecord(readings, { sex: "male" });
    expect(headlineFinding(findings)).toBe(findings[0]);
    expect(headlineFinding([])).toBeNull();
  });

  it("returns nothing for a record with too little history", () => {
    expect(analyseRecord([{ code: "creatinine", value: 1.0, takenAt: "2025-01-01T00:00:00Z" }])).toEqual([]);
  });
});

describe("the two renderings never disagree", () => {
  const finding = analyseSeries("creatinine", series([1.0, 1.3, 1.7]), { sex: "male" })!;

  it("gives the clinician values, dates and a percentage", () => {
    const text = describeForClinician(finding);
    expect(text).toContain("1 → 1.7 mg/dL");
    expect(text).toContain("+70%");
    expect(text).toMatch(/January 2025/);
  });

  it("gives the patient no raw numbers to misread", () => {
    const text = describeForPatient(finding);
    expect(text).not.toMatch(/mg\/dL/);
    expect(text).not.toMatch(/\d+%/);
  });

  it("never delivers a verdict to the patient", () => {
    // The line this engine must not cross: describing movement is fine,
    // pronouncing on it is a doctor's job.
    for (const values of [[1.0, 1.3, 1.7], [0.6, 0.75, 0.95], [1.7, 1.3, 1.0]]) {
      const text = describeForPatient(analyseSeries("creatinine", series(values), { sex: "male" })!);
      expect(text).not.toMatch(/\b(abnormal|dangerous|kidney disease|diagnos|failure)\b/i);
    }
  });
});
