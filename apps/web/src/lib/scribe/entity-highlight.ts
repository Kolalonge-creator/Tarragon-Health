import { SCRIBE_DRUG_SET } from "./drug-names";

/**
 * Finds the drug names and the numbers (doses, blood pressures, durations, counts) in a piece of draft text so the review screen can
 * mark them. Pure: no I/O. A wrong dose or a swapped drug is the error that hurts a patient and the one a skim misses, so these are
 * shown on their own line for the signing clinician to check against what was said (CMO decision Q19). Nothing here changes the text.
 */
export type EntityKind = "drug" | "number";
export interface TextPart {
  readonly text: string;
  readonly kind: EntityKind | null;
}

const UNIT = "(?:mg\\/dl|mmol\\/l|mmhg|mcg|µg|mg|kg|ml|iu|g|l|%|units?|tablets?|tabs?|capsules?|puffs?|drops?|times|days?|weeks?|months?|hours?)";
// 120/80, 2.5 mg, 500mg, 1,200 ml, 3 times: a number with its unit when one follows.
const NUMBER = `\\d+(?:[.,]\\d+)*(?:\\/\\d+)?(?:\\s?${UNIT}(?![\\p{L}\\p{N}]))?`;
const WORD = "[\\p{L}]+(?:-[\\p{L}]+)?";
const TOKEN = new RegExp(`(${NUMBER})|(${WORD})`, "giu");

export function splitEntities(text: string, drugs: ReadonlySet<string> = SCRIBE_DRUG_SET): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  const push = (end: number, kind: EntityKind | null, start: number) => {
    if (start > last) parts.push({ text: text.slice(last, start), kind: null });
    parts.push({ text: text.slice(start, end), kind });
    last = end;
  };
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    if (m[1]) push(start + m[1].length, "number", start);
    else if (m[2] && drugs.has(m[2].toLowerCase())) push(start + m[2].length, "drug", start);
  }
  if (last < text.length) parts.push({ text: text.slice(last), kind: null });
  return parts;
}

/** The distinct entities in order of first appearance, for a "check these" list. */
export function entitiesIn(text: string, drugs: ReadonlySet<string> = SCRIBE_DRUG_SET): { kind: EntityKind; text: string }[] {
  const seen = new Set<string>();
  const out: { kind: EntityKind; text: string }[] = [];
  for (const p of splitEntities(text, drugs)) {
    if (!p.kind) continue;
    const key = `${p.kind}:${p.text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: p.kind, text: p.text });
  }
  return out;
}
