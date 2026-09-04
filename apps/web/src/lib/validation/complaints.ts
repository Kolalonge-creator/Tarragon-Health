import { z } from "zod";

/** Matches the complaints.category CHECK constraint (plain text, not an enum — same choice clinical_incident_reports made). */
export const complaintCategorySchema = z.enum([
  "clinical_care",
  "billing",
  "communication",
  "appointment_service",
  "pharmacy_service",
  "laboratory_service",
  "data_privacy",
  "other",
]);
export type ComplaintCategoryInput = z.infer<typeof complaintCategorySchema>;

export const COMPLAINT_CATEGORY_LABEL: Record<ComplaintCategoryInput, string> = {
  clinical_care: "Clinical care",
  billing: "Billing or payment",
  communication: "Communication from your care team",
  appointment_service: "Appointment service",
  pharmacy_service: "Pharmacy service",
  laboratory_service: "Laboratory service",
  data_privacy: "Privacy or data handling",
  other: "Something else",
};

export const fileComplaintSchema = z.object({
  category: complaintCategorySchema,
  description: z.string().trim().min(10, "A sentence or two helps us understand what happened").max(4000),
  related_ticket_id: z.string().uuid().optional(),
});
export type FileComplaintInput = z.infer<typeof fileComplaintSchema>;

/** Matches clinical_incident_reports.category's CHECK constraint. */
export const incidentCategorySchema = z.enum([
  "medication_error",
  "misdiagnosis_risk",
  "escalation_delay",
  "communication_breakdown",
  "ai_recommendation_error",
  "protocol_deviation",
  "documentation_error",
  "other",
]);

/** Matches clinical_incident_reports.severity's CHECK constraint. */
export const incidentSeveritySchema = z.enum(["near_miss", "low", "medium", "high", "critical"]);

export const escalateComplaintToIncidentSchema = z.object({
  complaint_id: z.string().uuid(),
  category: incidentCategorySchema,
  severity: incidentSeveritySchema,
  description: z.string().trim().min(10, "Describe what indicated potential patient harm").max(2000),
});
export type EscalateComplaintToIncidentInput = z.infer<typeof escalateComplaintToIncidentSchema>;
