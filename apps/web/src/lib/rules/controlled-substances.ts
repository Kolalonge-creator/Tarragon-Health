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
 * ADVISORY ONLY, same discipline as drug-safety.ts: a curated illustrative
 * list of substances commonly subject to extra control (opioids,
 * benzodiazepines, stimulants, barbiturates), not a verified NDLEA schedule
 * lookup and not a dispensing gate — the platform never blocks a
 * prescription, it asks the prescriber to explicitly confirm the extra
 * safeguard before signing. Per CLAUDE.md: MDCN/regulatory confirmation of
 * any authority/schedule model is an open founder item, never represent
 * this as regulator-approved.
 */

export type ControlledSubstanceTier = "narcotic" | "restricted";

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

const CONTROLLED_PATTERNS: { pattern: RegExp; tier: ControlledSubstanceTier; label: string }[] = [
  { pattern: /\b(morphine|pethidine|meperidine|fentanyl|oxycodone|hydrocodone|methadone|diamorphine)\b/i, tier: "narcotic", label: "Opioid analgesic" },
  { pattern: /\b(codeine|tramadol|dihydrocodeine)\b/i, tier: "restricted", label: "Opioid analgesic (lower schedule)" },
  { pattern: /\b(diazepam|lorazepam|alprazolam|midazolam|clonazepam|chlordiazepoxide)\b/i, tier: "restricted", label: "Benzodiazepine" },
  { pattern: /\b(methylphenidate|amphetamine|dexamfetamine|dextroamphetamine|lisdexamfetamine)\b/i, tier: "narcotic", label: "Stimulant" },
  { pattern: /\b(phenobarbital(one)?)\b/i, tier: "restricted", label: "Barbiturate" },
  { pattern: /\bketamine\b/i, tier: "restricted", label: "Dissociative anaesthetic" },
];

/** Null when the drug name matches none of the curated patterns — this is
 * "no rule fired", never "confirmed not controlled". */
export function controlledSubstanceInfo(drugName: string): ControlledSubstanceInfo | null {
  const trimmed = drugName.trim();
  if (!trimmed) return null;
  for (const entry of CONTROLLED_PATTERNS) {
    if (entry.pattern.test(trimmed)) {
      return { tier: entry.tier, label: entry.label, note: TIER_COPY[entry.tier] };
    }
  }
  return null;
}
