import { getAnalyte, getQualitativeAnalyte } from "@/lib/lab-reports/analyte-catalogue";
import { interpretReading, type PatientContext } from "@/lib/lab-reports/reference-ranges";
import type { ExtractedRow } from "@/lib/lab-reports/extract";

/**
 * Drafts the "what this result means" text for a patient from the rows a
 * doctor has already confirmed and filed (lab_report_extractions.rows,
 * filtered to confirmed_codes) — the same "AI reads it, doctor cross-checks,
 * edits, and approves" shape as LabReportExtractionPanel already uses for the
 * numbers themselves, extended one step further into the plain-language
 * sentence a patient reads.
 *
 * Deliberately NOT an LLM call: every sentence is composed mechanically from
 * `interpretReading`'s deterministic, sourced reference bands (the same
 * engine LabReportExtractionPanel already renders on screen), so there is
 * nothing here for a model to hallucinate. This is a draft, never a final
 * answer — it always returns to an editable textarea the doctor must review
 * before "Send to patient" does anything (mark-result-reviewed.tsx).
 *
 * Deliberately does NOT draft next steps: interpretReading's `note` field is
 * written for the REVIEWING DOCTOR (see reference-ranges.ts's own file
 * header — "never anything a patient sees or is told"), not patient-facing
 * guidance, and a recommendation is a clinical judgement this module has no
 * business inventing. The doctor writes next steps themselves, same as
 * before this existed.
 */
export function draftInterpretationFromRows(
  rows: readonly ExtractedRow[],
  confirmedCodes: readonly string[],
  ctx: PatientContext,
): string {
  const confirmed = new Set(confirmedCodes);
  const sentences: string[] = [];

  for (const row of rows) {
    if (!row.code || !confirmed.has(row.code)) continue;

    const numericAnalyte = getAnalyte(row.code);
    const qualitativeAnalyte = getQualitativeAnalyte(row.code);
    const label = numericAnalyte?.label ?? qualitativeAnalyte?.label ?? row.label ?? row.reportedLabel;

    const rawValue = row.value ?? row.valueText;
    if (rawValue === null) continue;

    const interpretation = interpretReading(row.code, rawValue, ctx);
    const valueText =
      typeof rawValue === "number"
        ? `${rawValue}${row.canonicalUnit ? ` ${row.canonicalUnit}` : ""}`
        : rawValue;

    if (!interpretation) {
      sentences.push(`Your ${label} result was ${valueText}.`);
      continue;
    }

    switch (interpretation.status) {
      case "normal":
        sentences.push(`Your ${label} was ${valueText}, within the normal range.`);
        break;
      case "borderline":
        sentences.push(
          `Your ${label} was ${valueText}, a little ${interpretation.direction === "low" ? "below" : "above"} the healthy range.`,
        );
        break;
      case "abnormal":
        sentences.push(
          `Your ${label} was ${valueText}, which is ${interpretation.direction === "low" ? "below" : "above"} the healthy range.`,
        );
        break;
      case "critical":
        sentences.push(
          `Your ${label} was ${valueText}, which is significantly ${interpretation.direction === "low" ? "below" : "above"} the healthy range and needs prompt attention.`,
        );
        break;
    }
  }

  return sentences.join(" ");
}
