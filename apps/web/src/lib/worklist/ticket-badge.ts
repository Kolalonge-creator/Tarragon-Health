import type { BadgeProps } from "@/components/ui/badge";
import type { Enums } from "@tarragon/shared";

type SupportTicketStatus = Enums<"support_ticket_status">;
type SupportTicketPriority = Enums<"support_ticket_priority">;
type ComplaintStatus = Enums<"complaint_status">;

export const TICKET_STATUS_BADGE: Record<SupportTicketStatus, { variant: BadgeProps["variant"]; label: string }> = {
  new: { variant: "amber", label: "New" },
  assigned: { variant: "blue", label: "Assigned" },
  in_progress: { variant: "blue", label: "In progress" },
  awaiting_patient: { variant: "grey", label: "Awaiting you" },
  resolved: { variant: "green", label: "Resolved" },
  closed: { variant: "grey", label: "Closed" },
};

export const TICKET_PRIORITY_BADGE: Record<SupportTicketPriority, { variant: BadgeProps["variant"]; label: string }> = {
  critical: { variant: "red", label: "Critical" },
  high: { variant: "amber", label: "High" },
  normal: { variant: "blue", label: "Normal" },
  low: { variant: "grey", label: "Low" },
};

export const COMPLAINT_STATUS_BADGE: Record<ComplaintStatus, { variant: BadgeProps["variant"]; label: string }> = {
  received: { variant: "amber", label: "Received" },
  acknowledged: { variant: "blue", label: "Acknowledged" },
  assigned: { variant: "blue", label: "Assigned" },
  investigating: { variant: "blue", label: "Investigating" },
  response_sent: { variant: "blue", label: "Response sent" },
  resolved: { variant: "green", label: "Resolved" },
  governance_review: { variant: "grey", label: "Governance reviewed" },
};
