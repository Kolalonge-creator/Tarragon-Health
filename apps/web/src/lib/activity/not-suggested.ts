import { kindAllowed, type ActivityGateResult, type ActivitySafetyConfig } from "@tarragon/clinical/activity-gate";
import { COMMON_ACTIVITY_NAMES, KIND_BY_ACTIVITY_NAME } from "@/lib/validation/activity";

/**
 * The activity picker marks a kind the safety gate would not suggest right now. It never hides or blocks one: logging something that already
 * happened must always be possible, and the label says "not suggested", not "not allowed". While the gate or the config is unknown nothing is
 * marked (a label that could be wrong is worse than none), and under rest the banner already says so, so individual kinds are not marked.
 */
export function pickerLabel(
  name: (typeof COMMON_ACTIVITY_NAMES)[number],
  gate: ActivityGateResult | null,
  config: ActivitySafetyConfig | null,
): string {
  if (gate === null || config === null || gate.decision !== "restrict") return name;
  const kind = KIND_BY_ACTIVITY_NAME[name];
  if (kind === undefined) return name;
  return kindAllowed(gate, kind, config) ? name : `${name} (not suggested right now)`;
}
