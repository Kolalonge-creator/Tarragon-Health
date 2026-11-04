/** @jest-environment node */
import { describe, expect, it } from "@jest/globals";
import { draftNarrativeRules, matchNarrativeRules } from "./narrative-rules";

describe("draft narrative urgent-finding rules (CDE-01, unsigned)", () => {
  it("is a PROPOSED rule set owned by the CMO", () => {
    expect(draftNarrativeRules().ecg_qtc_urgent_ms).toBe(500);
  });

  it("raises BI-RADS 0, 4 and above as printed, and not 1 to 3", () => {
    expect(matchNarrativeRules({ birads: ["1", "4A"] })).toEqual([{ rule: "birads", matched: "4A" }]);
    expect(matchNarrativeRules({ birads: ["0"] })).toHaveLength(1);
    expect(matchNarrativeRules({ birads: ["2", "3", null] })).toEqual([]);
  });

  it("raises high-grade cervical cytology and HPV 16 or 18, not NILM or other types", () => {
    expect(matchNarrativeRules({ cervicalCytology: "High-grade squamous intraepithelial lesion (HSIL)" })[0]?.rule).toBe("cervical_cytology");
    expect(matchNarrativeRules({ cervicalCytology: "Negative for intraepithelial lesion or malignancy (NILM)" })).toEqual([]);
    expect(matchNarrativeRules({ hpvGenotypes: "HPV 18 detected" })).toEqual([{ rule: "hpv_genotype", matched: "18" }]);
    expect(matchNarrativeRules({ hpvGenotypes: "Other high-risk types (31, 33)" })).toEqual([]);
  });

  it("raises a malignancy term in a diagnosis line but not a negated one", () => {
    expect(matchNarrativeRules({ pathologyDiagnosis: "Invasive ductal carcinoma, grade 2" })[0]?.matched).toBe("carcinoma");
    expect(matchNarrativeRules({ pathologyDiagnosis: "Benign. No evidence of malignancy." })).toEqual([]);
    expect(matchNarrativeRules({ pathologyDiagnosis: "Negative for malignancy" })).toEqual([]);
  });

  it("raises listed ECG statements and a QTc of 500 ms or more", () => {
    expect(matchNarrativeRules({ ecgInterpretation: "Sinus rhythm. ST elevation in V1-V4." })[0]?.matched).toBe("st elevation");
    expect(matchNarrativeRules({ ecgInterpretation: "Sinus rhythm. Normal ECG.", ecgQtcMs: 499 })).toEqual([]);
    expect(matchNarrativeRules({ ecgQtcMs: 512 })).toEqual([{ rule: "ecg_qtc", matched: "QTc 512 ms" }]);
  });

  it("raises a critical radiology finding and ignores one that is ruled out", () => {
    expect(matchNarrativeRules({ imagingImpression: "Large right pneumothorax." })[0]?.matched).toBe("pneumothorax");
    expect(matchNarrativeRules({ imagingImpression: "No pneumothorax. No free air." })).toEqual([]);
    expect(matchNarrativeRules({ imagingImpression: "Pulmonary embolism excluded." })).toEqual([]);
  });

  it("does not let a negation elsewhere hide a finding (the safe direction)", () => {
    expect(matchNarrativeRules({ pathologyDiagnosis: "Lesion is not benign; carcinoma present" })[0]?.matched).toBe("carcinoma");
    expect(matchNarrativeRules({ pathologyDiagnosis: "No change since the previous biopsy, which showed carcinoma" })[0]?.matched).toBe("carcinoma");
    expect(matchNarrativeRules({ imagingImpression: "No effusion. Right pneumothorax." })[0]?.matched).toBe("pneumothorax");
  });
});
