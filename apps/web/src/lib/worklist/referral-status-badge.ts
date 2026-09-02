import type { BadgeProps } from "@/components/ui/badge";
import type { ReferralStatus } from "@tarragon/shared";

/** Shared staff-facing status badge/label for a specialist referral — used by the worklist, its detail page, and the patient-record Referrals tab. */
export const REFERRAL_STATUS_BADGE: Record<ReferralStatus, { variant: BadgeProps["variant"]; label: string }> = {
  draft: { variant: "grey", label: "Draft — not yet submitted" },
  pending: { variant: "amber", label: "Submitted" },
  pending_payment: { variant: "amber", label: "Awaiting payment" },
  payment_confirmed: { variant: "blue", label: "Ready to book" },
  booked: { variant: "blue", label: "Booked" },
  confirmed: { variant: "blue", label: "Confirmed" },
  completed: { variant: "blue", label: "Completed" },
  closed: { variant: "green", label: "Closed" },
  declined: { variant: "grey", label: "Declined" },
  waitlisted: { variant: "amber", label: "Waitlisted, interim plan in place" },
};
