import { z } from "zod";

/**
 * Filing a pathology or cervical screening result AS PRINTED (clinical document engine step 5b). Every clinical field is copied from
 * the report; nothing is coded or interpreted. The database checks the same rules (one result field per kind) and the document.
 */
export const PATHOLOGY_REPORT_KINDS = ["histopathology", "cytology", "cervical_cytology", "hpv"] as const;
export const HPV_RESULTS_AS_PRINTED = ["positive", "negative", "invalid"] as const;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const filePathologyReportSchema = z
  .object({
    documentId: z.string().uuid(),
    patientId: z.string().uuid(),
    report_kind: z.enum(PATHOLOGY_REPORT_KINDS),
    specimen: text(300),
    site: text(300),
    diagnosis_as_printed: text(4000),
    grade_as_printed: text(200),
    stage_as_printed: text(200),
    cytology_category_as_printed: text(300),
    hpv_result_as_printed: z.enum(HPV_RESULTS_AS_PRINTED).optional(),
    hpv_genotypes_as_printed: text(300),
    recommendation_as_printed: text(2000),
    pathologist_name: text(200),
    laboratory_name: text(200),
    reported_on: z.string().date().optional().or(z.literal("").transform(() => undefined)),
    note: z.string().trim().min(1, "Write your review note.").max(2000),
  })
  .refine(
    (d) =>
      (["histopathology", "cytology"].includes(d.report_kind) && !!d.diagnosis_as_printed) ||
      (d.report_kind === "cervical_cytology" && !!d.cytology_category_as_printed) ||
      (d.report_kind === "hpv" && !!d.hpv_result_as_printed),
    { message: "Copy the result line from the report (diagnosis, cytology category or HPV result).", path: ["report_kind"] },
  );
export type FilePathologyReportInput = z.input<typeof filePathologyReportSchema>;
