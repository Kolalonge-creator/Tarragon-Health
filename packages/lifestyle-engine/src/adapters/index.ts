/**
 * Adapter registry — the single lookup from condition key to its config.
 * Adding a 4th condition = add one adapter file + one registry entry, with
 * zero changes to core/ or safety/ (spec §18.8).
 */
import type { ConditionAdapter, ConditionKey } from "../types/index";
import { htnAdapter } from "./htn";
import { diabetesAdapter } from "./diabetes";
import { obesityAdapter } from "./obesity";

export { BASE_RED_FLAG_RULES } from "./base-rules";
export { htnAdapter } from "./htn";
export { diabetesAdapter } from "./diabetes";
export { obesityAdapter } from "./obesity";

const ADAPTERS: Record<ConditionKey, ConditionAdapter> = {
  htn: htnAdapter,
  diabetes: diabetesAdapter,
  obesity: obesityAdapter,
};

export function getAdapter(key: ConditionKey): ConditionAdapter {
  return ADAPTERS[key];
}

export function allAdapters(): readonly ConditionAdapter[] {
  return Object.values(ADAPTERS);
}
