import type { BadgeProps } from "@/components/ui/badge";
import type { Enums } from "@tarragon/shared";

/** Module 75.3's dashboard buckets (Open / Waiting on provider / Waiting on
 * patient / Resolved) -- "Urgent" is a cross-cutting is_urgent flag, not a
 * status, so it isn't in this map (see support-requests-worklist.tsx). */
export const NAVIGATION_REQUEST_STATUS_BADGE: Record<
  Enums<"navigation_request_status">,
  { variant: BadgeProps["variant"]; label: string }
> = {
  open: { variant: "amber", label: "Open" },
  waiting_on_provider: { variant: "blue", label: "Waiting on provider" },
  waiting_on_patient: { variant: "grey", label: "Waiting on patient" },
  resolved: { variant: "green", label: "Resolved" },
};

export const NAVIGATION_REQUEST_CLASSIFICATION_BADGE: Record<
  Enums<"navigation_request_classification">,
  { variant: BadgeProps["variant"]; label: string }
> = {
  non_clinical: { variant: "grey", label: "Non-clinical" },
  clinical: { variant: "red", label: "Looks clinical" },
};
