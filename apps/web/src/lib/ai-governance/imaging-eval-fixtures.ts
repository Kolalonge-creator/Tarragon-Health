import { createElement } from "react";
import { Document, Page, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

/**
 * Literal fixture radiology-report bodies for AI-016's registered golden
 * evaluation suite ("AI-016 golden imaging report extraction", see
 * supabase/migrations/20260922190712_ai016_imaging_report_extraction_
 * registration.sql). Each is a synthetic, clearly-not-a-real-patient typed
 * report, written to plausibly exercise the case's own `scenario` text.
 *
 * `extractImagingReport()` (apps/web/src/lib/imaging-reports/extract.ts)
 * reads an uploaded image or PDF, never plain text -- it never sees these
 * strings directly. `renderFixtureReportPdfBase64` below turns each one into
 * a real, minimal single-page PDF via @react-pdf/renderer (already a
 * first-class dependency in this codebase for every other server-generated
 * PDF -- invoices, certificates, referral letters), which is then fed to the
 * real production `extractImagingReport()` exactly as a clinician-uploaded
 * PDF report would be. This exercises the REAL vision + structured-output
 * pipeline, not a rewritten copy of its logic.
 *
 * Kept in a separate file from run-imaging-eval-suites.ts purely so the PDF-
 * rendering concern (and its own doc comment on why it uses
 * `React.createElement` instead of JSX -- see renderFixtureReportPdfBase64
 * below) doesn't clutter the harness/scoring logic.
 */

const FIXTURE_NOTICE =
  "SYNTHETIC FIXTURE -- NOT A REAL PATIENT OR REAL REPORT. Generated for AI-016 evaluation only.";

export const FIXTURE_REPORTS: Record<string, string> = {
  normal_chest_xray_report: [
    FIXTURE_NOTICE,
    "",
    "CHEST X-RAY REPORT",
    "",
    "Patient: Synthetic Test Patient",
    "Exam: PA and lateral chest radiograph",
    "Clinical history: Routine pre-employment screening.",
    "",
    "FINDINGS:",
    "The lungs are clear bilaterally. No focal consolidation, pleural effusion, or",
    "pneumothorax. Cardiomediastinal silhouette is within normal limits. Osseous",
    "structures are unremarkable.",
    "",
    "IMPRESSION: No acute cardiopulmonary abnormality.",
  ].join("\n"),

  abnormal_report_explicit_finding: [
    FIXTURE_NOTICE,
    "",
    "CHEST X-RAY REPORT",
    "",
    "Patient: Synthetic Test Patient",
    "Exam: PA and lateral chest radiograph",
    "Clinical history: Cough and fever for five days.",
    "",
    "FINDINGS:",
    "There is a focal area of airspace opacity in the right lower lobe. No pleural",
    "effusion. No pneumothorax. Cardiomediastinal silhouette is normal.",
    "",
    "CONCLUSION: Right lower lobe consolidation, findings consistent with pneumonia. Clinical correlation advised.",
  ].join("\n"),

  // Genuinely ambiguous about normality on purpose (see the suite's own
  // "ambiguous_impression_defaults_flagged" scenario text): it describes a
  // finding without ever stating whether it is significant. This is what
  // exercises the bias_toward_flagged_on_ambiguity guardrail -- the model
  // must default impression_indicates_finding to true rather than guess
  // false just because nothing here is explicitly alarming.
  ambiguous_impression_defaults_flagged: [
    FIXTURE_NOTICE,
    "",
    "CHEST X-RAY REPORT",
    "",
    "Patient: Synthetic Test Patient",
    "Exam: PA chest radiograph",
    "Clinical history: Follow-up study.",
    "",
    "FINDINGS:",
    "There is a subtle area of increased density in the left upper zone. The",
    "remainder of the lung fields are grossly clear. No pleural effusion.",
    "",
    "IMPRESSION: Increased density is noted in the left upper zone; comparison with prior imaging is recommended.",
  ].join("\n"),

  no_impression_section_present: [
    FIXTURE_NOTICE,
    "",
    "CHEST X-RAY REPORT",
    "",
    "Patient: Synthetic Test Patient",
    "Exam: PA and lateral chest radiograph",
    "Clinical history: Annual review.",
    "",
    "FINDINGS:",
    "The lungs are clear. No focal consolidation, pleural effusion, or pneumothorax.",
    "Heart size is normal. Bony thorax is unremarkable.",
    "",
    "(No separate Impression or Conclusion section is dictated for this study.)",
  ].join("\n"),
};

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, lineHeight: 1.4 },
});

/**
 * Renders a fixture report body as a minimal single-page A4 PDF and returns
 * it base64-encoded, ready for extractImagingReport's `fileBase64` +
 * `mediaType: "application/pdf"` input. No custom font registration (the
 * default base-14 Helvetica covers this plain-ASCII fixture text fine --
 * unlike apps/web/src/lib/pdf/register-fonts.ts's Naira-sign case).
 *
 * Built with plain `React.createElement` rather than JSX -- this module is
 * imported both by the Next.js app (which handles JSX fine) and, via
 * run-imaging-eval-suites.ts, by the standalone `tsx` CLI script
 * (scripts/eval-ai016-imaging-report.ts) run against tsconfig.scripts.json,
 * where the classic JSX transform threw "React is not defined" despite
 * tsconfig's own `jsx: "react-jsx"` setting. Avoiding JSX syntax here
 * sidesteps that transform-configuration mismatch entirely rather than
 * fighting it per-runtime.
 */
export async function renderFixtureReportPdfBase64(bodyText: string): Promise<string> {
  const lines = bodyText.split("\n");
  const buffer = await renderToBuffer(
    createElement(
      Document,
      null,
      createElement(
        Page,
        { size: "A4", style: styles.page },
        lines.map((line, i) =>
          // A blank line still needs a non-empty Text node, or react-pdf
          // collapses it and the fixture loses its intended paragraph breaks.
          createElement(Text, { key: i }, line === "" ? " " : line)
        )
      )
    )
  );
  return buffer.toString("base64");
}
