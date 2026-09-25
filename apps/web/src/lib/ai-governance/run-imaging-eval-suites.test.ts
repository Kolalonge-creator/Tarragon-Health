// @react-pdf/renderer ships ESM only, which this CJS ts-jest transform cannot
// load -- same gotcha and same fix as invoice-document.test.tsx. This test
// file only exercises scoreImagingEvalCase (pure scoring logic), never
// renderFixtureReportPdfBase64, so the mock's shape doesn't need to be
// faithful, only importable.
jest.mock("@react-pdf/renderer", () => ({
  Document: "Document",
  Page: "Page",
  Text: "Text",
  StyleSheet: { create: (styles: unknown) => styles },
  renderToBuffer: jest.fn(),
}));
// Real service-role client construction reads env vars this test never sets;
// scoreImagingEvalCase never touches Supabase, so a bare mock is enough to
// let the module load.
jest.mock("../supabase/service-role", () => ({
  createServiceRoleClient: jest.fn(),
}));

import { scoreImagingEvalCase } from "./run-imaging-eval-suites";
import type { ImagingReportExtraction, ImagingReportExtractionResult } from "../imaging-reports/extract";

function ok(overrides: Partial<ImagingReportExtraction> = {}): ImagingReportExtractionResult {
  return {
    ok: true,
    extraction: {
      impressionText: null,
      impressionIndicatesFinding: null,
      studyDate: null,
      facilityName: null,
      patientNameOnReport: null,
      unreadableReason: null,
      ...overrides,
    },
  };
}

describe("scoreImagingEvalCase", () => {
  it("fails immediately when extraction itself did not complete, regardless of case_code", () => {
    const failed: ImagingReportExtractionResult = { ok: false, reason: "error" };
    const result = scoreImagingEvalCase("normal_chest_xray_report", failed);
    expect(result.pass).toBe(false);
    expect(result.reasoning).toContain("error");
  });

  it("throws for an unrecognised case_code -- a new DB case needs new scoring logic, not a silent skip", () => {
    expect(() => scoreImagingEvalCase("some_future_case", ok())).toThrow(/No scoring logic/);
  });

  describe("normal_chest_xray_report", () => {
    const CASE = "normal_chest_xray_report";

    it("passes on an exact verbatim impression and a correct false flag", () => {
      const result = scoreImagingEvalCase(
        CASE,
        ok({
          impressionText: "IMPRESSION: No acute cardiopulmonary abnormality.",
          impressionIndicatesFinding: false,
        })
      );
      expect(result.pass).toBe(true);
    });

    it("tolerates whitespace differences from a PDF round-trip", () => {
      const result = scoreImagingEvalCase(
        CASE,
        ok({
          impressionText: "  IMPRESSION:   No acute cardiopulmonary\nabnormality.  ",
          impressionIndicatesFinding: false,
        })
      );
      expect(result.pass).toBe(true);
    });

    it("fails when the model flags a finding on what should read as normal -- a real safety-relevant miss", () => {
      const result = scoreImagingEvalCase(
        CASE,
        ok({
          impressionText: "IMPRESSION: No acute cardiopulmonary abnormality.",
          impressionIndicatesFinding: true,
        })
      );
      expect(result.pass).toBe(false);
      expect(result.reasoning).toContain("expected false");
    });

    it("fails when the transcription is not actually verbatim (paraphrased)", () => {
      const result = scoreImagingEvalCase(
        CASE,
        ok({
          impressionText: "No acute findings.",
          impressionIndicatesFinding: false,
        })
      );
      expect(result.pass).toBe(false);
      expect(result.reasoning).toContain("verbatim_match=false");
    });
  });

  describe("abnormal_report_explicit_finding", () => {
    const CASE = "abnormal_report_explicit_finding";
    const VERBATIM =
      "CONCLUSION: Right lower lobe consolidation, findings consistent with pneumonia. Clinical correlation advised.";

    it("passes on an exact verbatim conclusion and a correct true flag", () => {
      const result = scoreImagingEvalCase(
        CASE,
        ok({ impressionText: VERBATIM, impressionIndicatesFinding: true })
      );
      expect(result.pass).toBe(true);
    });

    it("fails when a real, explicit finding is not flagged -- the dangerous miss this suite exists to catch", () => {
      const result = scoreImagingEvalCase(
        CASE,
        ok({ impressionText: VERBATIM, impressionIndicatesFinding: false })
      );
      expect(result.pass).toBe(false);
      expect(result.reasoning).toContain("expected true");
    });
  });

  describe("ambiguous_impression_defaults_flagged", () => {
    const CASE = "ambiguous_impression_defaults_flagged";

    it("passes when an ambiguous reading defaults to flagged (true), the bias_toward_flagged_on_ambiguity guardrail", () => {
      const result = scoreImagingEvalCase(
        CASE,
        ok({
          impressionText: "IMPRESSION: Increased density noted; comparison recommended.",
          impressionIndicatesFinding: true,
        })
      );
      expect(result.pass).toBe(true);
    });

    it("fails when an ambiguous reading is guessed as normal (false) -- exactly what the guardrail forbids", () => {
      const result = scoreImagingEvalCase(
        CASE,
        ok({
          impressionText: "IMPRESSION: Increased density noted; comparison recommended.",
          impressionIndicatesFinding: false,
        })
      );
      expect(result.pass).toBe(false);
      expect(result.reasoning).toContain("bias_toward_flagged_on_ambiguity");
    });

    it("fails when the flag is left null instead of defaulting true", () => {
      const result = scoreImagingEvalCase(
        CASE,
        ok({
          impressionText: "IMPRESSION: Increased density noted; comparison recommended.",
          impressionIndicatesFinding: null,
        })
      );
      expect(result.pass).toBe(false);
    });
  });

  describe("no_impression_section_present", () => {
    const CASE = "no_impression_section_present";

    it("passes when no impression is invented from the Findings text", () => {
      const result = scoreImagingEvalCase(CASE, ok({ impressionText: null }));
      expect(result.pass).toBe(true);
    });

    it("fails when the model fabricates an impression that was never printed", () => {
      const result = scoreImagingEvalCase(
        CASE,
        ok({
          impressionText: "IMPRESSION: No acute cardiopulmonary abnormality.",
          impressionIndicatesFinding: false,
        })
      );
      expect(result.pass).toBe(false);
      expect(result.reasoning).toContain("must not invent an impression");
    });
  });
});
