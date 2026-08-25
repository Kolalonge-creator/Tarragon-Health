import {
  convertToCanonical,
  getEcgParameter,
  isKnownEcgParameterCode,
  resolveParameterCode,
  ECG_PARAMETER_CATALOGUE,
} from "./ecg-parameter-catalogue";

describe("resolveParameterCode", () => {
  it("resolves the many names one parameter is printed under", () => {
    for (const label of ["HR", "Heart Rate", "Vent. Rate", "Ventricular Rate"]) {
      expect(resolveParameterCode(label)).toBe("heart_rate");
    }
  });

  it("never lets QT collide with QTc — the most dangerous mix-up in this vocabulary", () => {
    // Filing a printed QTc under the qt_interval code (or vice versa) would
    // silently corrupt the Bazett cross-check and any future clinical use of
    // either trend.
    expect(resolveParameterCode("QT")).toBe("qt_interval");
    expect(resolveParameterCode("QT Interval")).toBe("qt_interval");
    expect(resolveParameterCode("QTc")).toBe("qtc_interval");
    expect(resolveParameterCode("QTcB")).toBe("qtc_interval");
    expect(resolveParameterCode("QTc (Bazett)")).toBe("qtc_interval");
    expect(resolveParameterCode("Corrected QT")).toBe("qtc_interval");
  });

  it("matches on whole words only", () => {
    expect(resolveParameterCode("QRS Duration")).toBe("qrs_duration");
    expect(resolveParameterCode("QRS Axis")).toBe("qrs_axis");
    // "axis" alone must still resolve to the cardiac axis code.
    expect(resolveParameterCode("Axis")).toBe("qrs_axis");
  });

  it("resolves the machine's own rhythm statement field", () => {
    expect(resolveParameterCode("Rhythm")).toBe("machine_rhythm_statement");
    expect(resolveParameterCode("Interpretation")).toBe("machine_rhythm_statement");
  });

  it("returns null for anything it does not recognise, rather than guessing", () => {
    expect(resolveParameterCode("Patient ID")).toBeNull();
    expect(resolveParameterCode("Recording Date")).toBeNull();
    expect(resolveParameterCode("")).toBeNull();
  });

  it("tolerates the punctuation real printouts use", () => {
    expect(resolveParameterCode("P-R Interval")).toBe("pr_interval");
    expect(resolveParameterCode("QTc(Bazett)")).toBe("qtc_interval");
  });
});

describe("convertToCanonical", () => {
  it("passes a value through unchanged when the unit already matches", () => {
    const result = convertToCanonical("heart_rate", 72, "bpm");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(72);
      expect(result.converted).toBe(false);
    }
  });

  it("converts an interval printed in seconds to the canonical ms", () => {
    // A cart that prints "0.16 s" for QRS duration must land as 160ms, not
    // silently accepted as 0.16 — a decimal-point/unit slip this severe would
    // make every downstream plausibility check pass on a nonsense value.
    const result = convertToCanonical("qrs_duration", 0.16, "s");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(160);
      expect(result.converted).toBe(true);
    }
  });

  it("refuses an unrecognised unit rather than assuming canonical", () => {
    const result = convertToCanonical("heart_rate", 72, "furlongs");
    expect(result.ok).toBe(false);
  });

  it("refuses the text-only machine_rhythm_statement code — it has no unit at all", () => {
    const result = convertToCanonical("machine_rhythm_statement", 1, null);
    expect(result.ok).toBe(false);
  });

  it("refuses an unknown code", () => {
    expect(convertToCanonical("not_a_real_code", 1, "ms").ok).toBe(false);
  });
});

describe("ECG_PARAMETER_CATALOGUE", () => {
  it("has no duplicate codes", () => {
    const codes = ECG_PARAMETER_CATALOGUE.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("every numeric parameter declares a canonical unit and a plausible band", () => {
    for (const p of ECG_PARAMETER_CATALOGUE) {
      if (p.group === "machine_statement") continue;
      expect(p.canonicalUnit).not.toBeNull();
      expect(p.plausible).not.toBeNull();
      expect(p.plausible![0]).toBeLessThan(p.plausible![1]);
    }
  });

  it("getEcgParameter / isKnownEcgParameterCode agree with the catalogue", () => {
    expect(isKnownEcgParameterCode("heart_rate")).toBe(true);
    expect(getEcgParameter("heart_rate")?.label).toBe("Heart rate");
    expect(isKnownEcgParameterCode("not_a_real_code")).toBe(false);
    expect(getEcgParameter("not_a_real_code")).toBeUndefined();
  });
});
