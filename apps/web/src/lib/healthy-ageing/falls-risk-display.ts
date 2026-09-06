import { FALLS_RISK_LEVEL_LABEL, type FallsRiskLevel } from "./types";

/**
 * How an open falls-risk pathway entry reads on the patient's snapshot tile.
 *
 * `falls_risk_assessments.risk_level` is nullable: a pathway entry can be
 * opened (a concern raised, a review booked) before anyone has graded it. That
 * unassessed state is NOT "low" — presenting it as a green "Low" tells an
 * older adult the very reassurance the record is still waiting on. It gets its
 * own grey "Awaiting review", alongside the tile's existing "Not checked" for
 * having no open entry at all.
 */
export type FallsRiskDisplay = {
  value: string;
  badge: { text: string; variant: "green" | "amber" | "red" | "grey" } | undefined;
};

const BADGE_VARIANT: Record<FallsRiskLevel, "green" | "amber" | "red"> = {
  low: "green",
  moderate: "amber",
  high: "red",
};

export function fallsRiskDisplay(
  fallsRisk: { riskLevel: FallsRiskLevel | null } | null
): FallsRiskDisplay {
  // No open pathway entry: nobody has looked, and the tile says so without a
  // badge (unchanged behaviour).
  if (!fallsRisk) return { value: "Not checked", badge: undefined };

  if (fallsRisk.riskLevel === null) {
    return { value: "Awaiting review", badge: { text: "Awaiting review", variant: "grey" } };
  }

  const label = FALLS_RISK_LEVEL_LABEL[fallsRisk.riskLevel];
  return { value: label, badge: { text: label, variant: BADGE_VARIANT[fallsRisk.riskLevel] } };
}
