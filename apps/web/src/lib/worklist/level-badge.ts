import type { BadgeProps } from "@/components/ui/badge";
import { ESCALATION_STATUS_LABEL, type EscalationLevel, type EscalationStatus } from "@tarragon/shared";

export const LEVEL_BADGE: Record<EscalationLevel, { variant: BadgeProps["variant"]; label: string }> = {
  emergency: { variant: "red", label: "Emergency" },
  specialist_review: { variant: "amber", label: "Specialist review" },
  urgent_escalation: { variant: "amber", label: "Urgent escalation" },
  clinician_review: { variant: "blue", label: "Doctor review" },
  routine: { variant: "grey", label: "Routine" },
};

export const ESCALATION_STATUS_BADGE: Record<EscalationStatus, { variant: BadgeProps["variant"]; label: string }> = {
  open: { variant: "amber", label: ESCALATION_STATUS_LABEL.open },
  under_review: { variant: "blue", label: ESCALATION_STATUS_LABEL.under_review },
  awaiting_information: { variant: "blue", label: ESCALATION_STATUS_LABEL.awaiting_information },
  patient_contact_required: { variant: "amber", label: ESCALATION_STATUS_LABEL.patient_contact_required },
  monitoring: { variant: "grey", label: ESCALATION_STATUS_LABEL.monitoring },
  resolved: { variant: "green", label: ESCALATION_STATUS_LABEL.resolved },
  referred: { variant: "grey", label: ESCALATION_STATUS_LABEL.referred },
};
