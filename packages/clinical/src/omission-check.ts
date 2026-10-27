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

import { applyAliases, textMatchesAny, textMatchesTerm, tokenise, tokensMatchTerm, type MatchOptions } from "./text-match";

export interface OmissionRules {
  /**
   * class name -> words (generic names and brands). A class is active for a patient when an allergy entry names any of its words
   * (whole words, with one typo allowed in words of six letters or more). Every member is then checked against the draft.
   */
  allergyClasses: Record<string, readonly string[]>;
  /** Groups of words for the same drug (generic and brand names) that sit outside any class. Same matching as a class. */
  drugSynonyms?: readonly (readonly string[])[];
  /** Allergens positively known not to be drugs (food, latex, "none"). Anything else the lists cannot place raises "allergy not checked". */
  nonDrugAllergens?: readonly string[];
  /** Words that carry no allergen meaning on their own ("allergy", "rash"), skipped when an unplaced allergen is checked word by word. */
  allergenNoiseWords?: readonly string[];
  /** Spelling variants mapped to one spelling, applied to both the allergy and the draft (for example sulpha to sulfa). */
  spellingAliases?: Readonly<Record<string, string>>;
  /** A patient with one of these conditions on file should have a follow-up interval stated in the draft. */
  followUpRequiredConditions: readonly string[];
  /** Words that show a clause is about a follow-up ("review", "see you", "appointment"). An interval counts only inside such a clause. */
  followUpContextTerms?: readonly string[];
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
  | "allergy_not_checked"
  | "restricted_item"
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

/** Whole-word, case-insensitive containment (no typo tolerance). Empty terms never match. */
export function mentions(text: string, term: string): boolean {
  return textMatchesTerm(text, term);
}

const mentionsAny = (text: string, terms: readonly string[]): boolean => textMatchesAny(text, terms);

/** A stated interval: "in 2 weeks", "review after 3 months", "next week", "in a month", "follow up in two weeks". */
const INTERVAL =
  /(?<!\b(?:for|since|over|past|last|previous)\s+)\b(?:(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+(?:day|days|week|weeks|month|months)|next\s+(?:week|month)|tomorrow)\b/i;

/** Dosing frequency ("twice a day", "3 times a week", "every day"), which is not a follow-up interval. */
const DOSING_FREQUENCY =
  /\b(?:(?:once|twice|thrice|daily|times|(?:\d+|one|two|three|four|five|six)\s+times)\s+(?:a|per|each|every)\s+(?:day|week|month)|(?:per|each|every)\s+(?:day|week|month))\b/gi;

/** A clause ends at a sentence stop (not a decimal point), a semicolon, a comma or a line break. */
const CLAUSE_BREAK = /[;,\n!?]+|\.(?!\d)|(?<!\d)\./;

/**
 * True when some clause both states an interval and is about a follow-up. A bare "a day" in a dose, or "for 3 days" describing a
 * symptom, is not a follow-up interval. With no context terms configured nothing qualifies, so the flag errs on the side of showing.
 */
export function hasFollowUpInterval(text: string, contextTerms: readonly string[] = []): boolean {
  if (contextTerms.length === 0) return false;
  return text.split(CLAUSE_BREAK).some((clause) => {
    const withoutDosing = clause.replace(DOSING_FREQUENCY, " ");
    return INTERVAL.test(withoutDosing) && textMatchesAny(withoutDosing, contextTerms);
  });
}

export function checkOmissions(input: OmissionInput, rules: OmissionRules, meta: OmissionRulesMeta): OmissionResult {
  const draft = input.draftText;
  const flags: OmissionFlag[] = [];
  const unused: UnusedSourceItem[] = [];

  // 1. A drug named in the draft versus the allergy list. Whole-word matching with spelling aliases and one typo allowed in longer words,
  //    so "sulpha", "Septrin" and "penicilin" are all understood. An allergen the lists cannot place is flagged, never skipped silently.
  const aliases = rules.spellingAliases ?? {};
  const matchOptions: MatchOptions = { aliases, fuzzy: true };
  const draftTokens = applyAliases(tokenise(draft), aliases);
  const drugGroups: string[][] = [
    ...Object.entries(rules.allergyClasses).map(([name, words]) => [name, ...words]),
    ...(rules.drugSynonyms ?? []).map((g) => [...g]),
  ];
  const noise = new Set((rules.allergenNoiseWords ?? []).map((w) => tokenise(w).join(" ")));
  for (const allergy of input.allergies) {
    const allergenTokens = applyAliases(tokenise(allergy.allergen), aliases);
    if (allergenTokens.length === 0) continue;
    const terms = new Set<string>([allergenTokens.join(" ")]);
    let placed = false;
    for (const group of drugGroups) {
      if (!group.some((w) => tokensMatchTerm(allergenTokens, w, matchOptions))) continue;
      placed = true;
      for (const w of group) terms.add(tokenise(w).join(" "));
    }
    if (!placed && (rules.nonDrugAllergens ?? []).some((t) => tokensMatchTerm(allergenTokens, t, matchOptions))) placed = true;
    if (!placed) {
      // Unplaced: the allergen's own words (minus filler like "allergy") are the only thing the draft can be checked for.
      for (const t of allergenTokens) if (t.length >= 4 && !noise.has(t)) terms.add(t);
    }
    terms.delete("");
    for (const drug of terms) {
      if (!tokensMatchTerm(draftTokens, drug, matchOptions)) continue;
      flags.push({
        kind: "drug_vs_allergy",
        severity: "info",
        sourceId: allergy.id,
        detail: `${drug} (allergy on file: ${allergy.allergen})`,
        message: `The draft names ${drug}. The record lists an allergy to ${allergy.allergen}. Check this is intended.`,
      });
    }
    if (!placed) {
      flags.push({
        kind: "allergy_not_checked",
        severity: "info",
        sourceId: allergy.id,
        detail: allergy.allergen,
        message: `Allergy not checked: unrecognised allergen (${allergy.allergen}). The draft was only checked for the allergen's own words, not for related drugs. Check it by hand.`,
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
  const required = input.conditions.filter((c) => mentionsAny(c.name, rules.followUpRequiredConditions));
  const followUpStated = hasFollowUpInterval(draft, rules.followUpContextTerms ?? []);
  if (required.length > 0 && !followUpStated) {
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
    if (!followUpStated) unused.push({ kind: "condition", id: c.id, label: c.name });
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
