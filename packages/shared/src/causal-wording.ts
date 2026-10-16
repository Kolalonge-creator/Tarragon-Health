/**
 * The "no causal claim" wording check (S75c, spec 22.9). Anything a sponsor receives (the pilot pack JSON, the CSV, the PDF) is scanned before it is
 * issued. A sentence that states a limit ("this does not show that the programme caused any change") is allowed: a sentence containing a negation
 * is not scanned. The same two patterns live in the database (`private.causal_wording_hits`); `causal-wording.test.ts` compares them with the
 * lines between the `causal-pattern` markers in the migration so the two cannot drift.
 */
export const CAUSAL_PATTERN =
  "\\b(caused|causes|causing|because of the programme|due to the programme|as a result of the programme|thanks to the programme|led to|leads to|resulted in|results in|attributable to|attributed to|proves|proved|proven|demonstrates that|demonstrated that|saved|savings|return on investment|roi|prevented|reduced the risk|impact of the programme|improved because)\\b";
export const NEGATION_PATTERN = "\\b(not|no|never|cannot|without|nor|neither|rather than)\\b|n't";

/** The offending phrases found in the text (empty when it is clean). */
export function causalWordingHits(text: string): string[] {
  const hits = new Set<string>();
  const cause = new RegExp(CAUSAL_PATTERN, "g");
  const negation = new RegExp(NEGATION_PATTERN);
  for (const raw of text.split(/[.!?;\n]+/)) {
    const sentence = raw.toLowerCase();
    if (negation.test(sentence)) continue;
    for (const m of sentence.matchAll(cause)) hits.add(m[1] as string);
  }
  return [...hits];
}

/** Every string in a JSON-like value, joined as sentences, so the check sees what a reader would read. */
export function allStrings(value: unknown): string {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(value);
  return out.join(". ");
}
