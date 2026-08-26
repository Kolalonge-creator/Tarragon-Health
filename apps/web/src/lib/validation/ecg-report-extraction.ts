import { z } from "zod";
import { isKnownEcgParameterCode } from "@/lib/ecg-reports/ecg-parameter-catalogue";

/**
 * What a reviewing clinician is allowed to submit when confirming an
 * extracted ECG's parameters. Mirrors validation/lab-report-extraction.ts:
 * every field is re-validated here rather than trusted from the draft — a
 * reviewer can correct a misread value on screen, so what arrives is the
 * HUMAN's number, not the model's.
 */
export const confirmedEcgParameterSchema = z
  .object({
    code: z.string().refine(isKnownEcgParameterCode, {
      message: "Unknown ECG parameter code",
    }),
    /** Already in the parameter's canonical unit — the review UI converts before submit. */
    value: z.number().finite().optional(),
    /** The machine's own printed rhythm statement (machine_rhythm_statement only). */
    value_text: z.string().min(1).max(200).optional(),
    /** Canonical unit, required alongside a numeric value and forbidden without one. */
    unit: z.string().max(10).optional(),
  })
  .superRefine((row, ctx) => {
    const hasValue = row.value !== undefined;
    const hasText = row.value_text !== undefined;
    // Exactly one, mirroring the ecg_parameter_readings_one_value constraint.
    if (hasValue === hasText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each parameter needs either a number or the machine's printed text, not both.",
      });
      return;
    }
    if (hasValue && !row.unit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A numeric parameter must carry its unit.",
      });
    }
  });

export const confirmEcgReportExtractionSchema = z.object({
  extraction_id: z.string().uuid(),
  /**
   * Date the ECG was recorded. The reviewer can correct it, and it is what
   * every filed parameter is stamped with.
   */
  report_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a yyyy-mm-dd date")
    .refine(
      (value) => {
        const parsed = new Date(`${value}T00:00:00Z`);
        if (Number.isNaN(parsed.getTime())) return false;
        return parsed.getTime() <= Date.now() + 24 * 60 * 60 * 1000;
      },
      { message: "The recording date cannot be in the future" },
    ),
  parameters: z
    .array(confirmedEcgParameterSchema)
    .min(1, "Select at least one parameter to file")
    .max(10)
    .refine(
      (rows) => new Set(rows.map((r) => r.code)).size === rows.length,
      { message: "The same parameter appears twice — keep only one value per parameter" },
    ),
});

export type ConfirmEcgReportExtractionInput = z.infer<typeof confirmEcgReportExtractionSchema>;
