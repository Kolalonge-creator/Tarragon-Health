import type { HealthScoreRiskLevel } from "@/lib/rules/health-score";

// The Overview's one status vocabulary (spec §76.2's "Your health: Stable"
// line, now rendered inside the hero band's score zone rather than as a
// standalone banner). Shared here so the hero, the Score details card, and
// anything else reading patient_risk_scores.risk_level can never disagree on
// the word or its colour. Clinical status colours (green/amber/red), never
// brand tones — see CLAUDE.md.
export const HEALTH_STATUS_WORD: Record<HealthScoreRiskLevel, { word: string; dot: string }> = {
  low: { word: "Stable", dot: "bg-green-500" },
  moderate: { word: "Improving", dot: "bg-amber-500" },
  high: { word: "Needs attention", dot: "bg-red-500" },
  very_high: { word: "Needs urgent attention", dot: "bg-red-600" },
};

// Meter fill/track pairs stay on one hue ramp per risk level (never a grey
// track) so the state reads across the whole bar, filled or not.
export const HEALTH_STATUS_METER: Record<HealthScoreRiskLevel, { fill: string; track: string }> = {
  low: { fill: "bg-green-500", track: "bg-green-100" },
  moderate: { fill: "bg-amber-500", track: "bg-amber-100" },
  high: { fill: "bg-red-500", track: "bg-red-100" },
  very_high: { fill: "bg-red-500", track: "bg-red-100" },
};
