import { z } from "zod";

const IMAGING_MODALITIES = [
  "xray",
  "ultrasound",
  "ct",
  "mri",
  "mammography",
  "echocardiography",
  "other",
] as const;

const FINDING_URGENCIES = ["routine", "clinically_significant", "urgent", "critical"] as const;

/**
 * A clinician filing the structured imaging report (spec §59.10) for an
 * order — either after reviewing a patient/staff-uploaded document, or
 * entered directly. is_abnormal + urgency drive the abnormal-imaging
 * pathway (private.handle_imaging_report_abnormal_pathway, spec §59.13):
 * urgency is only meaningful when is_abnormal is true, enforced below
 * rather than in the DB (the DB's own default is 'routine' regardless).
 */
export const fileImagingReportSchema = z
  .object({
    imaging_order_id: z.string().uuid(),
    modality: z.enum(IMAGING_MODALITIES),
    body_region: z.string().trim().min(1).max(200),
    study_date: z.string().date(),
    radiologist_name: z.string().trim().max(200).optional(),
    findings: z.string().trim().min(1, "Findings are required").max(8000),
    impression: z.string().trim().min(1, "An impression is required").max(4000),
    is_abnormal: z.boolean().default(false),
    urgency: z.enum(FINDING_URGENCIES).default("routine"),
    dicom_study_instance_uid: z.string().trim().max(200).optional(),
    dicom_accession_number: z.string().trim().max(100).optional(),
    pacs_url: z.string().trim().url().optional(),
    document_id: z.string().uuid().optional(),
  })
  .refine((data) => data.is_abnormal || data.urgency === "routine", {
    message: "Urgency above routine only applies to an abnormal finding",
    path: ["urgency"],
  });
export type FileImagingReportInput = z.infer<typeof fileImagingReportSchema>;

/** A clinician noting an incidental finding on a filed report (spec §59.12). */
export const createIncidentalFindingSchema = z.object({
  imaging_report_id: z.string().uuid(),
  description: z.string().trim().min(1, "A description is required").max(2000),
  is_urgent: z.boolean().default(false),
  follow_up_due_date: z.string().date().optional(),
});
export type CreateIncidentalFindingInput = z.infer<typeof createIncidentalFindingSchema>;
