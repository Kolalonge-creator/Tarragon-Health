import type { BadgeProps } from "@/components/ui/badge";
import type { ReferralUrgency } from "@tarragon/shared";

export const URGENCY_BADGE: Record<ReferralUrgency, { variant: BadgeProps["variant"]; label: string }> = {
  routine: { variant: "grey", label: "Routine — within weeks" },
  priority: { variant: "amber", label: "Priority — within days" },
  urgent: { variant: "red", label: "Urgent — same day" },
};
