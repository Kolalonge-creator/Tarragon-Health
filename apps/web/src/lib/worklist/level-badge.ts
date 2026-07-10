import type { BadgeProps } from "@/components/ui/badge";
import type { EscalationLevel, EscalationStatus } from "@tarragon/shared";

export const LEVEL_BADGE: Record<EscalationLevel, { variant: BadgeProps["variant"]; label: string }> = {
  emergency: { variant: "red", label: "Emergency" },
  urgent_escalation: { variant: "amber", label: "Urgent escalation" },
  clinician_review: { variant: "blue", label: "Clinician review" },
  routine: { variant: "grey", label: "Routine" },
};

export const ESCALATION_STATUS_BADGE: Record<EscalationStatus, { variant: BadgeProps["variant"]; label: string }> = {
  open: { variant: "amber", label: "Unclaimed" },
  under_review: { variant: "blue", label: "Under review" },
  resolved: { variant: "green", label: "Resolved" },
  referred: { variant: "grey", label: "Referred" },
};
