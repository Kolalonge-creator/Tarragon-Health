import { z } from "zod";
import { isKnownAnalyteCode } from "@/lib/lab-reports/analyte-catalogue";

/**
 * What a reviewing clinician is allowed to submit when confirming an extracted
 * lab report.
 *
 * Every field is re-validated here rather than trusted from the draft: a
 * reviewer can correct a misread value or a wrong unit on screen, so what
 * arrives is the HUMAN's number, not the model's, and it must stand on its own.
 */
export const confirmedAnalyteRowSchema = z.object({
  code: z.string().refine(isKnownAnalyteCode, {
    message: "Unknown analyte code",
  }),
  /** Already in the analyte's canonical unit — the review UI converts before submit. */
  value: z.number().finite(),
});

export const confirmLabReportExtractionSchema = z.object({
  extraction_id: z.string().uuid(),
  /**
   * Collection date from the report. The reviewer can correct it, and it is
   * what each reading is stamped with — an uploaded-late report still lands in
   * the right place on the trend line.
   */
  report_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a yyyy-mm-dd date")
    .refine(
      (value) => {
        const parsed = new Date(`${value}T00:00:00Z`);
        if (Number.isNaN(parsed.getTime())) return false;
        // A result cannot have been collected in the future.
        return parsed.getTime() <= Date.now() + 24 * 60 * 60 * 1000;
      },
      { message: "The collection date cannot be in the future" },
    ),
  rows: z
    .array(confirmedAnalyteRowSchema)
    .min(1, "Select at least one result to file")
    .max(60)
    .refine(
      (rows) => new Set(rows.map((r) => r.code)).size === rows.length,
      { message: "The same test appears twice — keep only one value per test" },
    ),
});

export type ConfirmLabReportExtractionInput = z.infer<typeof confirmLabReportExtractionSchema>;
