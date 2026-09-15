export type HealthScoreRiskLevel = "low" | "moderate" | "high" | "very_high";

/**
 * Native mirror of apps/web/src/components/health-status-banner.tsx's status
 * vocabulary -- kept in its own file, separate from the general design
 * tokens in ui/theme.ts, for the same reason web keeps this out of its
 * design-token file: clinical status colours (green/amber/red) are a
 * separate system from brand colour and must never be confused with it
 * (CLAUDE.md). Values are the same Tailwind shades web uses (green/amber/red
 * -500, red -600 for very_high, and their -100 tints for meter tracks) so the
 * two platforms read as the same feature.
 */
export const HEALTH_STATUS_WORD: Record<HealthScoreRiskLevel, { word: string; dot: string }> = {
  low: { word: "Stable", dot: "#22C55E" },
  moderate: { word: "Improving", dot: "#F59E0B" },
  high: { word: "Needs attention", dot: "#EF4444" },
  very_high: { word: "Needs urgent attention", dot: "#DC2626" },
};

/** Meter fill/track pairs stay on one hue ramp per risk level (never a grey
 * track) so the state reads across the whole bar, filled or not. high and
 * very_high deliberately share the same red-100 track, matching web. */
export const HEALTH_STATUS_METER: Record<HealthScoreRiskLevel, { fill: string; track: string }> = {
  low: { fill: "#22C55E", track: "#DCFCE7" },
  moderate: { fill: "#F59E0B", track: "#FEF3C7" },
  high: { fill: "#EF4444", track: "#FEE2E2" },
  very_high: { fill: "#DC2626", track: "#FEE2E2" },
};
