import type { BadgeProps } from "@/components/ui/badge";

/**
 * Ordering for the lifestyle safety-flag worklist.
 *
 * The page fetched `opened_at` ascending only, so an emergency flag raised
 * this morning rendered below last week's amber one. Severity has to lead;
 * age only breaks ties (and within a severity, oldest first, because an old
 * unstood-down flag is the one that has slipped).
 *
 * `severity` is the lpe_red_flag_severity enum (amber | red | emergency);
 * escalation_level is the engine's own numeric ladder, used as the tiebreak
 * before age.
 */

const SEVERITY_RANK: Record<string, number> = {
  emergency: 0,
  red: 1,
  amber: 2,
};

export function lifestyleSeverityRank(severity: string): number {
  return SEVERITY_RANK[severity] ?? 3;
}

export function lifestyleSeverityVariant(severity: string): NonNullable<BadgeProps["variant"]> {
  if (severity === "emergency" || severity === "red") return "red";
  if (severity === "amber") return "amber";
  return "grey";
}

/** Emergency reads differently from red even though both are red chips —
 * the label carries that, the colour cannot. */
export function lifestyleSeverityLabel(severity: string): string {
  if (severity === "emergency") return "Emergency";
  if (severity === "red") return "Red flag";
  if (severity === "amber") return "Amber";
  return severity;
}

export interface RankableFlag {
  severity: string;
  escalationLevel: number;
  openedAt: string;
}

export function compareLifestyleFlags(a: RankableFlag, b: RankableFlag): number {
  const severityDiff = lifestyleSeverityRank(a.severity) - lifestyleSeverityRank(b.severity);
  if (severityDiff !== 0) return severityDiff;
  const levelDiff = b.escalationLevel - a.escalationLevel;
  if (levelDiff !== 0) return levelDiff;
  return a.openedAt.localeCompare(b.openedAt);
}
