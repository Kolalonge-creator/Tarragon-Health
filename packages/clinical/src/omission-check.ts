/**
 * Omission and consistency checker (S89). Pure and deterministic: no model, no I/O, no clock.
 *
 * Given a clinician's own draft note or plan and structured record data, it returns NON-BLOCKING flags and a list of record items
 * the draft does not mention. It decides nothing and never blocks signing: `blocksSigning` is the literal `false` on every result.
 *
 * Every clinical list it uses (drug classes for allergy matching, conditions that need a stated follow-up interval)
 * arrives as the `rules` argument, loaded by the caller from the versioned, PROPOSED config key
 * `copilot.omission_rules`. Nothing clinical is hard-coded here. The rules version and status travel in the result so a screen can
 * say plainly when the lists are not yet signed.
 */

export interface OmissionRules {
  /** class name -> words. A class is active for a patient when an allergy entry contains any of its words. */
  allergyClasses: Record<string, readonly string[]>;
  /** A patient with one of these conditions on file should have a follow-up interval stated in the draft. */
  followUpRequiredConditions: readonly string[];
}

export interface OmissionRulesMeta {
  version: number;
  status: "proposed" | "confirmed";
}

export interface RecordAllergy { id: string; allergen: string }
export interface RecordMedication { id: string; name: string }
export interface RecordCondition { id: string; name: string }
export interface RecordAbnormalResult {
  id: string;
  label: string;
  /** Extra words that would show the draft addresses this result (the analyte name, for example). */
  terms?: readonly string[];
}

export interface OmissionInput {
  /** The clinician's draft: note sections and plan joined, as typed. */
  draftText: string;
  allergies: readonly RecordAllergy[];
  medications: readonly RecordMedication[];
  conditions: readonly RecordCondition[];
  /** Abnormal results the record shows as still awaiting action. */
  awaitingResults: readonly RecordAbnormalResult[];
}

export type OmissionFlagKind =
  | "drug_vs_allergy"
  | "result_not_mentioned"
  | "no_follow_up_interval"
  | "medication_not_mentioned";

export interface OmissionFlag {
  kind: OmissionFlagKind;
  /** Always "info": a flag is a prompt to look, never an instruction. */
  severity: "info";
  /** The record row the flag is about (allergy, result, condition or medication id). */
  sourceId: string;
  /** What the draft names or what the record holds, for the reviewer. */
  detail: string;
  message: string;
}

export interface UnusedSourceItem {
  kind: "medication" | "result" | "allergy" | "condition";
  id: string;
  label: string;
}

export interface OmissionResult {
  blocksSigning: false;
  flags: OmissionFlag[];
  sourceItemsNotUsed: UnusedSourceItem[];
  rulesVersion: number;
  rulesStatus: OmissionRulesMeta["status"];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Whole-word, case-insensitive containment. Empty terms never match. */
export function mentions(text: string, term: string): boolean {
  const t = norm(term);
  if (t === "") return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(t)}([^a-z0-9]|$)`).test(norm(text));
}

const mentionsAny = (text: string, terms: readonly string[]): boolean => terms.some((t) => mentions(text, t));

/** A stated interval: "in 2 weeks", "review after 3 months", "next week", "in a month", "follow up in two weeks". */
const INTERVAL = /\b((\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+(day|days|week|weeks|month|months)|next\s+(week|month)|tomorrow)\b/i;

export function hasFollowUpInterval(text: string): boolean {
  return INTERVAL.test(text);
}

function containsPhrase(haystack: string, needle: string): boolean {
  return norm(haystack).includes(norm(needle));
}

export function checkOmissions(input: OmissionInput, rules: OmissionRules, meta: OmissionRulesMeta): OmissionResult {
  const draft = input.draftText;
  const flags: OmissionFlag[] = [];
  const unused: UnusedSourceItem[] = [];

  // 1. A drug named in the draft versus the allergy list.
  for (const allergy of input.allergies) {
    const allergen = norm(allergy.allergen);
    if (allergen === "") continue;
    const named = new Set<string>();
    if (mentions(draft, allergen)) named.add(allergen);
    for (const words of Object.values(rules.allergyClasses)) {
      const classActive = words.some((w) => containsPhrase(allergen, w) || allergen === norm(w));
      if (!classActive) continue;
      for (const w of words) if (mentions(draft, w)) named.add(norm(w));
    }
    for (const drug of named) {
      flags.push({
        kind: "drug_vs_allergy",
        severity: "info",
        sourceId: allergy.id,
        detail: `${drug} (allergy on file: ${allergy.allergen})`,
        message: `The draft names ${drug}. The record lists an allergy to ${allergy.allergen}. Check this is intended.`,
      });
    }
  }

  // 2. An abnormal result awaiting action that the draft does not mention.
  for (const result of input.awaitingResults) {
    const specific = [result.label, ...(result.terms ?? [])];
    if (!mentionsAny(draft, specific)) {
      flags.push({
        kind: "result_not_mentioned",
        severity: "info",
        sourceId: result.id,
        detail: result.label,
        message: `An abnormal result is awaiting action (${result.label}). The draft does not mention it.`,
      });
      unused.push({ kind: "result", id: result.id, label: result.label });
    }
  }

  // 3. No follow-up interval where a rule requires one.
  const required = input.conditions.filter((c) => mentionsAny(c.name, rules.followUpRequiredConditions) || rules.followUpRequiredConditions.some((r) => containsPhrase(c.name, r)));
  if (required.length > 0 && !hasFollowUpInterval(draft)) {
    const first = required[0];
    if (first) {
      flags.push({
        kind: "no_follow_up_interval",
        severity: "info",
        sourceId: first.id,
        detail: required.map((c) => c.name).join(", "),
        message: `The record lists ${required.map((c) => c.name).join(", ")}. The draft states no follow-up interval.`,
      });
    }
  }
  for (const c of required) {
    if (!hasFollowUpInterval(draft)) unused.push({ kind: "condition", id: c.id, label: c.name });
  }

  // 4. A medication in the record not mentioned in the draft.
  for (const med of input.medications) {
    if (!mentions(draft, med.name)) {
      flags.push({
        kind: "medication_not_mentioned",
        severity: "info",
        sourceId: med.id,
        detail: med.name,
        message: `${med.name} is on the medicine list. The draft does not mention it.`,
      });
      unused.push({ kind: "medication", id: med.id, label: med.name });
    }
  }

  // Allergies not named anywhere in the draft are listed as unused source items too (a prompt to glance at them), without a flag.
  for (const allergy of input.allergies) {
    if (!mentions(draft, allergy.allergen)) unused.push({ kind: "allergy", id: allergy.id, label: allergy.allergen });
  }

  return { blocksSigning: false, flags, sourceItemsNotUsed: unused, rulesVersion: meta.version, rulesStatus: meta.status };
}
