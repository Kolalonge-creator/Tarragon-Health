/**
 * Mirrors apps/web/src/lib/rules/bp-classification.ts — non-clinical
 * presentation only (the badge shown next to a reading). The authoritative
 * classifier is the DB trigger (`private.classify_bp_level`); this never
 * gates an escalation, it only colours the list. Keep in lock-step with the
 * web copy if the bands change.
 */
export type BpLevel = "green" | "amber" | "red" | "emergency" | "unknown";

/** Overridable via threshold-sync.ts's loadActiveThresholds() if the server
 * reports a newer version than this bundled default. */
export const BP_THRESHOLDS = {
  emergency: { systolic: 200, diastolic: 120 },
  red: { systolic: 160, diastolic: 100 },
  amber: { systolic: 135, diastolic: 85 },
} as const;

/**
 * Structural, not `typeof BP_THRESHOLDS`. The bundled constant is `as const`,
 * so `typeof` it is a set of LITERAL types (systolic: 200, ...) — which made
 * the `thresholds` parameter below nominally un-overridable: the only value
 * the compiler would accept was the bundled constant itself. It only worked
 * at runtime because threshold-sync.ts's cache is typed, not checked. The
 * whole point of that parameter is to carry server-synced values, so the
 * type says numbers.
 */
export interface BpThresholds {
  emergency: { systolic: number; diastolic: number };
  red: { systolic: number; diastolic: number };
  amber: { systolic: number; diastolic: number };
}

export function classifyBpLevel(
  systolic: number | null | undefined,
  diastolic: number | null | undefined,
  thresholds: BpThresholds = BP_THRESHOLDS
): BpLevel {
  if (systolic == null || diastolic == null) return "unknown";
  if (diastolic >= thresholds.emergency.diastolic || systolic >= thresholds.emergency.systolic) return "emergency";
  if (systolic >= thresholds.red.systolic || diastolic >= thresholds.red.diastolic) return "red";
  if (systolic >= thresholds.amber.systolic || diastolic >= thresholds.amber.diastolic) return "amber";
  return "green";
}

export const BP_LEVEL_LABEL: Record<BpLevel, string> = {
  green: "At target",
  amber: "Above target",
  red: "High (urgent review)",
  emergency: "Crisis range",
  unknown: "—",
};

/** Deliberately literal hexes, not ui/theme.ts tokens: this palette mirrors
 * the web badge colours verbatim (see the lock-step note above), so it stays
 * a copy of the web values rather than adopting the native token set. */
export const BP_LEVEL_COLORS: Record<BpLevel, { bg: string; text: string }> = {
  green: { bg: "#DCFCE7", text: "#15803D" },
  amber: { bg: "#FEF3C7", text: "#B45309" },
  red: { bg: "#FEE2E2", text: "#B91C1C" },
  emergency: { bg: "#7F1D1D", text: "#FFFFFF" },
  unknown: { bg: "#F3F4F6", text: "#6B7280" },
};
