import { getProposedConfig, type ConfigValue } from "@tarragon/shared";

/**
 * The draft urgent-finding rules for narrative reports (CDE-01, clinical document engine step 5b): given fields AS PRINTED on an
 * imaging, mammography, ECG, pathology or cervical report, which rules would raise its doctor review to urgent.
 *
 * INERT: the rule set is PROPOSED and unsigned (OQ-CDE-11), and no code path calls this to escalate anything. It exists so the CMO
 * can see exactly what the rules would do before signing, and so the wiring, once signed, uses a tested matcher. A rule only ever
 * raises priority; no match means routine review, never "normal".
 */

export interface NarrativeRules {
  readonly birads_urgent: readonly string[];
  readonly cervical_cytology_urgent: readonly string[];
  readonly hpv_genotypes_urgent: readonly string[];
  readonly pathology_urgent_terms: readonly string[];
  readonly ecg_urgent_terms: readonly string[];
  readonly ecg_qtc_urgent_ms: number;
  readonly imaging_urgent_terms: readonly string[];
  readonly negation_words_before: readonly string[];
  readonly negation_phrases_before: readonly string[];
  readonly negations_after: readonly string[];
  /** The escalation_slas tier (pathway screening_abnormal_result) a match on each rule pages at; the minutes live in escalation_slas. */
  readonly paging_tier_by_rule: Readonly<Record<NarrativeMatch["rule"], PagingTier>>;
}

export type PagingTier = "emergency" | "urgent_escalation";

export interface NarrativeFields {
  readonly birads?: readonly (string | null | undefined)[];
  readonly cervicalCytology?: string | null;
  readonly hpvGenotypes?: string | null;
  readonly pathologyDiagnosis?: string | null;
  readonly ecgInterpretation?: string | null;
  readonly ecgQtcMs?: number | null;
  readonly imagingImpression?: string | null;
}

export interface NarrativeMatch {
  readonly rule: "birads" | "cervical_cytology" | "hpv_genotype" | "pathology" | "ecg" | "ecg_qtc" | "imaging";
  readonly matched: string;
}

export function draftNarrativeRules(): NarrativeRules {
  return getProposedConfig<ConfigValue>("documents.narrative_urgent_rules").value as unknown as NarrativeRules;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A term found in the text, unless that mention is negated in the same clause: a bare negation word at most one word before it ("no
 * residual carcinoma"), a negation phrase at most three words before it ("negative for intraepithelial lesion or malignancy"), or a
 * phrase straight after it ("pneumothorax excluded"). Anything looser could hide a real finding ("not benign; carcinoma", "no change in
 * the known carcinoma"); on this side of the rules erring toward urgent is the safe direction.
 */
function findTerm(text: string, terms: readonly string[], rules: NarrativeRules): string | null {
  const lower = text.toLowerCase();
  const alt = (xs: readonly string[]) => xs.map((n) => escape(n.toLowerCase())).join("|");
  const before = new RegExp(
    `(?:\\b(?:${alt(rules.negation_words_before)})(?:\\s+[a-z0-9-]+)?|\\b(?:${alt(rules.negation_phrases_before)})(?:\\s+[a-z0-9-]+){0,3})\\s*$`,
  );
  const after = new RegExp(`^\\s*(?:${rules.negations_after.map((n) => escape(n.toLowerCase())).join("|")})\\b`);
  for (const term of terms) {
    const re = new RegExp(`(^|[^a-z0-9])${escape(term.toLowerCase())}(?![a-z0-9])`, "g");
    for (const m of lower.matchAll(re)) {
      const start = (m.index ?? 0) + m[1]!.length;
      const clause = lower.slice(0, start).split(/[.;:\n]/).pop() ?? "";
      const rest = lower.slice(start + term.length);
      if (!before.test(clause) && !after.test(rest)) return term;
    }
  }
  return null;
}

export function matchNarrativeRules(fields: NarrativeFields, rules: NarrativeRules = draftNarrativeRules()): NarrativeMatch[] {
  const out: NarrativeMatch[] = [];
  for (const b of fields.birads ?? []) {
    const v = b?.trim().toUpperCase();
    if (v && rules.birads_urgent.includes(v)) {
      out.push({ rule: "birads", matched: v });
      break;
    }
  }
  const add = (rule: NarrativeMatch["rule"], text: string | null | undefined, terms: readonly string[]) => {
    if (!text) return;
    const hit = findTerm(text, terms, rules);
    if (hit) out.push({ rule, matched: hit });
  };
  add("cervical_cytology", fields.cervicalCytology, rules.cervical_cytology_urgent);
  if (fields.hpvGenotypes) {
    const types = fields.hpvGenotypes.match(/\d+/g) ?? [];
    const hit = types.find((t) => rules.hpv_genotypes_urgent.includes(t));
    if (hit) out.push({ rule: "hpv_genotype", matched: hit });
  }
  add("pathology", fields.pathologyDiagnosis, rules.pathology_urgent_terms);
  add("ecg", fields.ecgInterpretation, rules.ecg_urgent_terms);
  if (typeof fields.ecgQtcMs === "number" && fields.ecgQtcMs >= rules.ecg_qtc_urgent_ms) {
    out.push({ rule: "ecg_qtc", matched: `QTc ${fields.ecgQtcMs} ms` });
  }
  add("imaging", fields.imagingImpression, rules.imaging_urgent_terms);
  return out;
}

/**
 * The highest paging tier among the matches ("emergency" outranks "urgent_escalation"), or null when nothing matched. `rules` is required
 * on purpose: the caller must pass the value the CMO confirmed (checked against proposed_config_signoffs), never the unconfirmed draft.
 * A tier that is missing or not one of the two known values counts as "emergency": a typo in the registry must page higher, never lower.
 */
export function pagingTierFor(matches: readonly NarrativeMatch[], rules: NarrativeRules): PagingTier | null {
  if (matches.length === 0) return null;
  return matches.some((m) => rules.paging_tier_by_rule[m.rule] !== "urgent_escalation") ? "emergency" : "urgent_escalation";
}
