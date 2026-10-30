/**
 * Controlled/restricted-medicine flag for the prescribing workspace (Care
 * Team / Provider Workspace §5.19 — "prescribing controlled/restricted
 * medicines... high-risk medication" needs additional safeguards). Two of
 * the spec's other three examples ("certain diagnoses", "urgent escalation")
 * already have real gates elsewhere in this codebase — the obesity/BMI
 * ED-screen attestation, the red-flag attestation, and
 * canHandleEmergencyEscalation's Tier 2+ gate — so this file exists
 * specifically to close the one that had nothing: no drug-schedule/
 * controlled-substance concept existed anywhere (confirmed by a repo-wide
 * grep before writing this).
 *
 * ADVISORY ONLY, same discipline as drug-safety.ts: an illustrative list of
 * substances commonly subject to extra control (opioids, benzodiazepines,
 * stimulants, barbiturates), not a verified NDLEA schedule lookup. This
 * file holds NO drug names (OQ-484): the list is the database table
 * public.controlled_medicine_terms, owned by the Chief Medical Officer and
 * read through ./controlled-medicine-list (with a generated offline
 * fallback). The database is the hard stop at signing and at the counter;
 * this file only supplies the advice shown beside it. Per CLAUDE.md: MDCN/regulatory confirmation of
 * any authority/schedule model is an open founder item, never represent
 * this as regulator-approved.
 */

import {
  fallbackControlledMedicineList,
  matchControlledMedicineTerm,
  type ControlledMedicineList,
  type ControlledSubstanceTier,
} from "./controlled-medicine-list";

export type { ControlledSubstanceTier };

export interface ControlledSubstanceInfo {
  tier: ControlledSubstanceTier;
  label: string;
  note: string;
}

const TIER_COPY: Record<ControlledSubstanceTier, string> = {
  narcotic:
    "Commonly subject to the strictest prescribing/dispensing control (narcotic-class analgesics, stimulants). Confirm indication, quantity, and duration are all documented, and that this prescription follows your facility's controlled-medicine protocol.",
  restricted:
    "Commonly subject to additional prescribing control (benzodiazepines, lower-schedule opioids, barbiturates, dissociatives). Confirm the indication and duration are documented and dependence/misuse risk has been considered.",
};

/**
 * Null when the drug name matches no term on the list: this is "no rule fired", never "confirmed not controlled".
 * Pass the list read from the database (loadControlledMedicineList / useControlledMedicineList); without one, the generated fallback is used.
 */
export function controlledSubstanceInfo(drugName: string, list: ControlledMedicineList = fallbackControlledMedicineList()): ControlledSubstanceInfo | null {
  const hit = matchControlledMedicineTerm(list, drugName);
  return hit ? { tier: hit.tier, label: hit.label, note: TIER_COPY[hit.tier] } : null;
}
