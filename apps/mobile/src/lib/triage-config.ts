import { getProposedConfig } from "@tarragon/shared";

/**
 * Typed loader for the triage wiring values in the versioned registry (`triage.wiring_rules`, S12). Only the value the phone
 * needs for itself is read here: how long since it last checked for the approved rule set before it warns that its
 * guidance may be out of date. The rest of the entry is mirrored in SQL and the engine budgets next to it.
 */
export interface TriageWiringConfig {
  version: number;
  staleAfterDays: number;
}

export function loadTriageWiringConfig(asOf?: string): TriageWiringConfig {
  const r = getProposedConfig("triage.wiring_rules", asOf);
  const v = r.value as Record<string, unknown> | null;
  const days = v?.["staleAfterDays"];
  if (typeof days !== "number" || !Number.isFinite(days) || days < 1) {
    throw new Error("Config triage.wiring_rules.staleAfterDays must be a number >= 1");
  }
  return { version: r.version, staleAfterDays: days };
}
