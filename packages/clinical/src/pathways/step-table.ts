import { getProposedConfig } from "@tarragon/shared";
import { proposeTitration, validateProtocolDefinition } from "../titration";
import type { ProtocolDefinition } from "../titration-types";

/**
 * The DRAFT hypertension step table (decision pack Q1 option A). It is read from the PROPOSED config entry `pathways.hypertension_step_table`
 * and validated by the existing titration evaluator's own validator, so it is exactly the shape a `protocols` row holds. It is DRAFT and an
 * agent never approves it: the evaluator lets a draft drive a proposal for a TEST patient only (spec 6.3).
 */
export function loadHypertensionStepTable(asOf?: string): ProtocolDefinition {
  const v = validateProtocolDefinition(getProposedConfig("pathways.hypertension_step_table", asOf).value);
  if (!v.ok) throw new Error(`pathways.hypertension_step_table is not a valid protocol definition: ${v.errors.join("; ")}`);
  if (v.definition.status !== "draft") throw new Error("an agent only ever ships this step table as a draft");
  return v.definition;
}

export const HTN_RTSL_NG_DRAFT: ProtocolDefinition = loadHypertensionStepTable();

/** Step ids in ladder order, for the property tests and the mirror test. */
export const HTN_STEP_IDS: readonly string[] = HTN_RTSL_NG_DRAFT.steps.map((s) => s.id);

export { proposeTitration };
