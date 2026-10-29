import { z } from "zod";

/**
 * Numbers a patient confirms from their own uploaded report (migration 20261029192438). The database re-checks every rule here
 * (confirm_my_lab_report), this only gives the form a clear message first.
 */
export const patientReportedLabSchema = z.object({
  extractionId: z.string().uuid(),
  // the date printed on the report, never in the future
  reportDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Give the date printed on the report")
    .refine((d) => !Number.isNaN(Date.parse(d)) && d >= "1990-01-01", "Give the date printed on the report"),
  readings: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(80),
        value: z.number().finite().min(0).max(1_000_000),
        unit: z.string().trim().max(30).nullable().optional(),
      }),
    )
    .min(1, "Confirm at least one number")
    .max(60),
});

export type PatientReportedLabInput = z.infer<typeof patientReportedLabSchema>;
