import type { HealthScoreRiskLevel } from "./health-score";

/**
 * The Tailwind v4 theme color variable each HealthScoreRiskLevel's ScoreRing should
 * use — a real CSS variable name (e.g. "--color-green-500"), not a raw hex value, so
 * ScoreRing's opacity-based track trick works in both light and dark mode with no
 * separate dark value needed. Matches health-status-banner.tsx's HEALTH_STATUS_METER
 * fill colors (green/amber/red-500) so the ring, the hero meter, and any future score
 * visual all read as the same clinical-status color system.
 */
export const RISK_LEVEL_RING: Record<HealthScoreRiskLevel, string> = {
  low: "--color-green-500",
  moderate: "--color-amber-500",
  high: "--color-red-500",
  very_high: "--color-red-500",
};
