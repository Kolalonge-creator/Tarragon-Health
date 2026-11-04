import "server-only";
import { z } from "zod";
import { validateExtractedRow, type ExtractedRow } from "@/lib/lab-reports/extract";
import { checkConsistency } from "@/lib/lab-reports/qc";
import { getAnalyte, getQualitativeAnalyte } from "@/lib/lab-reports/analyte-catalogue";

/**
 * Clinical document engine step 3 (CDE-02): results a Care Coordinator types in by hand become a draft for a clinician, built by
 * the SAME validation an AI reading goes through (validateExtractedRow: catalogue code, unit conversion, plausibility; then the
 * cross-row consistency checks). A typed row is not trusted more than a machine reading: an unknown unit, an implausible value or
 * a test outside the catalogue is surfaced to the clinician, never quietly filed.
 */

export const LAB_FLAGS = ["none", "normal", "high", "low", "abnormal", "critical"] as const;

export const manualRowSchema = z
  .object({
    /** A catalogue code, or "other" for a test outside the catalogue (then `label` names it). */
    code: z.string().trim().min(1).max(60),
    label: z.string().trim().max(120).optional(),
    value: z.number().finite().nullable().optional(),
    valueText: z.string().trim().max(60).nullable().optional(),
    unit: z.string().trim().max(30).nullable().optional(),
    labRange: z.string().trim().max(60).nullable().optional(),
    labFlag: z.enum(LAB_FLAGS).default("none"),
    specimen: z.string().trim().max(60).nullable().optional(),
    comment: z.string().trim().max(300).nullable().optional(),
  })
  .refine((r) => r.code !== "other" || (r.label && r.label.length >= 2), { message: "Name the test." })
  .refine((r) => (r.value !== null && r.value !== undefined) || (r.valueText && r.valueText.length > 0), {
    message: "Every test needs a result.",
  });

export const manualRowsSchema = z.array(manualRowSchema).min(1, "Add at least one result.").max(60, "No more than 60 results at once.");

export type ManualRowInput = z.infer<typeof manualRowSchema>;
export type ManualDetail = { labFlag: (typeof LAB_FLAGS)[number]; specimen: string | null; comment: string | null };

export type ManualDraft = { rows: ExtractedRow[]; details: ManualDetail[] } | { error: string };

export function labelFor(input: ManualRowInput): string {
  if (input.code === "other") return input.label ?? "Unnamed test";
  return getAnalyte(input.code)?.label ?? getQualitativeAnalyte(input.code)?.label ?? input.label ?? input.code;
}

export function buildManualDraft(inputs: readonly ManualRowInput[]): ManualDraft {
  const seen = new Set<string>();
  for (const input of inputs) {
    if (input.code === "other") continue;
    if (!getAnalyte(input.code) && !getQualitativeAnalyte(input.code)) return { error: "One of the tests is not in the list. Choose it again." };
    if (seen.has(input.code)) return { error: `${labelFor(input)} is entered twice. Keep one.` };
    seen.add(input.code);
  }

  const rows = inputs.map((input) =>
    validateExtractedRow({
      reported_label: labelFor(input),
      code: input.code === "other" ? null : input.code,
      value: input.value ?? null,
      value_text: input.valueText ?? null,
      unit: input.unit ?? null,
      reported_range: input.labRange ?? null,
      // Typed by a person from the source: "high" only means the characters were not guessed. The clinician still checks each row.
      confidence: "high",
    }),
  );
  // A test typed under "not in this list" may still resolve to a catalogue code by its name; it must not double a listed one.
  const resolved = new Set<string>();
  for (const row of rows) {
    if (!row.code) continue;
    if (resolved.has(row.code)) return { error: `${row.label ?? row.reportedLabel} is entered twice. Keep one.` };
    resolved.add(row.code);
  }
  checkConsistency(rows);

  const details: ManualDetail[] = inputs.map((input) => ({
    labFlag: input.labFlag,
    specimen: input.specimen ?? null,
    comment: input.comment ?? null,
  }));
  return { rows, details };
}

/** The typed rows as printed on the transcript PDF: what the coordinator typed, nothing converted. */
export function transcriptRows(inputs: readonly ManualRowInput[]) {
  return inputs.map((input) => ({
    test: labelFor(input),
    result: input.valueText ?? (input.value === null || input.value === undefined ? "" : String(input.value)),
    unit: input.unit ?? "",
    labRange: input.labRange ?? "",
    labFlag: input.labFlag === "none" ? "" : input.labFlag,
    specimenComment: [input.specimen, input.comment].filter(Boolean).join(" · "),
  }));
}
