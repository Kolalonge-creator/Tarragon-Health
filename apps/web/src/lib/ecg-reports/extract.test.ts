import { validateExtractedParameter, normaliseReportDate } from "./extract";

function raw(overrides: Partial<Parameters<typeof validateExtractedParameter>[0]> = {}) {
  return {
    reported_label: "HR",
    code: null,
    value: 72,
    value_text: null,
    unit: "bpm",
    confidence: "high" as const,
    ...overrides,
  };
}

describe("validateExtractedParameter", () => {
  it("marks a well-formed numeric row ready", () => {
    const result = validateExtractedParameter(raw());
    expect(result.status).toBe("ready");
    expect(result.code).toBe("heart_rate");
    expect(result.value).toBe(72);
    expect(result.canonicalUnit).toBe("bpm");
  });

  it("marks an unresolvable label unmapped rather than guessing", () => {
    const result = validateExtractedParameter(
      raw({ reported_label: "Something the model invented", code: "not_a_real_code" }),
    );
    expect(result.status).toBe("unmapped");
    expect(result.code).toBeNull();
  });

  it("marks an implausible value implausible, not silently ready", () => {
    // A heart rate of 900 is a misread, not a real reading.
    const result = validateExtractedParameter(raw({ value: 900 }));
    expect(result.status).toBe("implausible");
  });

  it("marks an unconvertible unit unknown_unit", () => {
    const result = validateExtractedParameter(raw({ unit: "furlongs" }));
    expect(result.status).toBe("unknown_unit");
  });

  it("converts a QRS duration printed in seconds", () => {
    const result = validateExtractedParameter(
      raw({ reported_label: "QRS Duration", value: 0.09, unit: "s" }),
    );
    expect(result.status).toBe("ready");
    expect(result.value).toBeCloseTo(90, 5);
    expect(result.converted).toBe(true);
  });

  it("handles the machine_rhythm_statement text field without treating it as numeric", () => {
    const result = validateExtractedParameter(
      raw({
        reported_label: "Rhythm",
        value: null,
        value_text: "Normal sinus rhythm",
        unit: null,
      }),
    );
    expect(result.status).toBe("ready");
    expect(result.code).toBe("machine_rhythm_statement");
    expect(result.valueText).toBe("Normal sinus rhythm");
    expect(result.value).toBeNull();
  });

  it("attaches a low_confidence flag when the model says so", () => {
    const result = validateExtractedParameter(raw({ confidence: "low" }));
    expect(result.flags.some((f) => f.key === "low_confidence")).toBe(true);
  });

  it("prefers our own label resolution over a model-claimed code when they disagree", () => {
    // The label unambiguously says QTc; a model-hallucinated code of
    // "qt_interval" must not win, or a QTc would silently corrupt the QT trend.
    const result = validateExtractedParameter(
      raw({ reported_label: "QTc", code: "qt_interval", value: 430, unit: "ms" }),
    );
    expect(result.code).toBe("qtc_interval");
  });
});

describe("normaliseReportDate", () => {
  it("passes through an already-ISO date", () => {
    expect(normaliseReportDate("2026-08-12")).toBe("2026-08-12");
  });

  it("returns null for unparseable input", () => {
    expect(normaliseReportDate("not a date")).toBeNull();
    expect(normaliseReportDate(null)).toBeNull();
  });

  it("rejects a date more than a day in the future — a misread, not a real recording", () => {
    const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(normaliseReportDate(farFuture)).toBeNull();
  });
});
