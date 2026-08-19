/**
 * Mirrors apps/web/src/lib/rules/bp-classification.ts — non-clinical
 * presentation only (the badge shown next to a reading). The authoritative
 * classifier is the DB trigger (`private.classify_bp_level`); this never
 * gates an escalation, it only colours the list. Keep in lock-step with the
 * web copy if the bands change.
 */
export type BpLevel = "green" | "amber" | "red" | "emergency" | "unknown";

export function classifyBpLevel(
  systolic: number | null | undefined,
  diastolic: number | null | undefined
): BpLevel {
  if (systolic == null || diastolic == null) return "unknown";
  if (diastolic >= 120 || systolic >= 200) return "emergency";
  if (systolic >= 160 || diastolic >= 100) return "red";
  if (systolic >= 135 || diastolic >= 85) return "amber";
  return "green";
}

export const BP_LEVEL_LABEL: Record<BpLevel, string> = {
  green: "At target",
  amber: "Above target",
  red: "High — urgent review",
  emergency: "Crisis range",
  unknown: "—",
};

export const BP_LEVEL_COLORS: Record<BpLevel, { bg: string; text: string }> = {
  green: { bg: "#DCFCE7", text: "#15803D" },
  amber: { bg: "#FEF3C7", text: "#B45309" },
  red: { bg: "#FEE2E2", text: "#B91C1C" },
  emergency: { bg: "#7F1D1D", text: "#FFFFFF" },
  unknown: { bg: "#F3F4F6", text: "#6B7280" },
};
