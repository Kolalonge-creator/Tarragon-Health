// Pass-mark gate for the speech gold set (Q19). Pure: takes the result of evaluate() and says PASS, FAIL or NOT_ENOUGH_DATA.
//
// The mark is 95 percent on drug names and 95 percent on numbers, each on its own: a vendor that is superb on numbers must not hide
// weak drug names behind an average. "Correct" means the entity in the clinician-corrected reference was heard right (scoreClip
// decides this; a substitution or a deletion counts as wrong). Entities the vendor INVENTED are reported and never netted off against
// misses. Dropped negations are reported too ("no chest pain" heard as "chest pain" is a safety error even when no drug is wrong).
//
// This is a measurement and a recommendation. Choosing a vendor, and switching the AI scribe on (AI-017, off), stay with the CMO.
export const DEFAULTS = Object.freeze({ passMark: 0.95, minClips: 20, minTerms: 30, minClipsForAccentGap: 3 });

const accuracy = (total, wrong) => (total === 0 ? null : (total - wrong) / total);

export function gate(result, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const t = result.totals;
  const drug = accuracy(t.drugTerms, t.drugWrong);
  const number = accuracy(t.numberTerms, t.numberWrong);
  const reasons = [];
  if (t.clips < o.minClips) reasons.push(`only ${t.clips} clip(s); the gold set needs at least ${o.minClips}`);
  if (t.drugTerms < o.minTerms) reasons.push(`only ${t.drugTerms} drug-name occurrence(s); at least ${o.minTerms} are needed to trust a rate`);
  if (t.numberTerms < o.minTerms) reasons.push(`only ${t.numberTerms} number occurrence(s); at least ${o.minTerms} are needed to trust a rate`);
  const enough = reasons.length === 0;
  const belowDrug = drug !== null && drug < o.passMark;
  const belowNumber = number !== null && number < o.passMark;
  // A failure is a failure however small the set: a vendor already below the mark on 12 clips will not recover on 24.
  const verdict = belowDrug || belowNumber ? "FAIL" : enough ? "PASS" : "NOT_ENOUGH_DATA";
  const accentGaps = result.byAccent
    .filter((a) => a.clips >= o.minClipsForAccentGap)
    .map((a) => ({ accent: a.key, clips: a.clips, drug: accuracy(a.drugTerms, a.drugWrong), number: accuracy(a.numberTerms, a.numberWrong) }))
    .filter((a) => (a.drug !== null && a.drug < o.passMark) || (a.number !== null && a.number < o.passMark));
  return {
    verdict, passMark: o.passMark, drugAccuracy: drug, numberAccuracy: number,
    reasons, accentGaps,
    safety: { negationsDropped: t.negationsDropped, inventedDrugs: t.falseDrugs, inventedNumbers: t.falseNumbers },
  };
}

const pct = (x) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
export function renderGate(g) {
  const L = [`PASS MARK ${(g.passMark * 100).toFixed(0)}% (drug names and numbers, each on its own): ${g.verdict}`, `  drug-name accuracy ${pct(g.drugAccuracy)}   number accuracy ${pct(g.numberAccuracy)}`];
  for (const r of g.reasons) L.push(`  not enough data: ${r}`);
  for (const a of g.accentGaps) L.push(`  accent gap: ${a.accent} (${a.clips} clips) drug ${pct(a.drug)}, number ${pct(a.number)}: below the mark even if the total is not`);
  L.push(`  safety: ${g.safety.negationsDropped} negation(s) dropped, ${g.safety.inventedDrugs} invented drug name(s), ${g.safety.inventedNumbers} invented number(s) (reported, never netted off)`);
  L.push("  A measurement, not a decision: choosing a vendor, and switching the AI scribe on (AI-017, off), stay with the CMO.");
  return L.join("\n");
}
