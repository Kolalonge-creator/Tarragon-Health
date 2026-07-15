import type { BadgeProps } from "@/components/ui/badge";
import type { ScreeningResultStatus } from "@tarragon/shared";

export const RESULT_STATUS_BADGE: Record<ScreeningResultStatus, { variant: BadgeProps["variant"]; label: string }> = {
  normal: { variant: "green", label: "Normal" },
  borderline: { variant: "amber", label: "Borderline" },
  abnormal: { variant: "amber", label: "Needs follow-up" },
  critical: { variant: "red", label: "Needs urgent follow-up" },
};
