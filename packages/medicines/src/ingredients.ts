/**
 * Duplicate-ingredient check (S08y, item 1).
 *
 * Two medicines that share an active ingredient (for example a cold remedy and a painkiller that both contain paracetamol,
 * or two brands of the same antibiotic) add up to more of that ingredient than either label says. This is deterministic text
 * matching only: it compares the ingredient names it is given, never a dose and never a clinical judgement, and it only WARNS.
 * It cannot stop, change or remove a medicine (INV-02), and there is no model anywhere near it (INV-01).
 *
 * One rule, two implementations, as with the as-needed limits: this is the phone's and the web's; `private.duplicate_ingredient_pairs`
 * in the database is the server's twin, and both run the cases in `ingredients.fixtures.ts`. A clean result means "no shared
 * name found in what we were given", never "safe": salts and spellings that differ (amlodipine besylate and amlodipine) are
 * not matched, and a brand we cannot resolve is compared by the name typed.
 *
 * Order independent: the answer never depends on the order medicines are listed in.
 */

/** Lower case; every run of anything but a to z and 0 to 9 becomes one space; trimmed. ASCII only, on purpose, so SQL can match it exactly. */
export function normaliseIngredient(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const SPLITTER = /\s*(?:\band\b|\bwith\b|\/|\+|,|&|;)\s*/;

/** A strength ("10mg", "0.5 g", "5 ml") or a dose form ("tablets", "syrup") typed after the name is not part of the ingredient. */
const STRENGTH_OR_FORM = /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|ug|g|ml|iu|units?)\b|\b(?:tablets?|tabs?|capsules?|caps?|syrup|suspension|injection|cream|ointment|drops)\b/g;

/**
 * The separate ingredients named in one generic name: "Amoxicillin and clavulanic acid" is two. A strength or dose form typed after the
 * name ("Lisinopril 10mg tablets") is dropped. Sorted, no repeats, no blanks.
 */
export function splitIngredients(generic: string): string[] {
  const parts = generic
    .toLowerCase()
    .split(SPLITTER)
    .map((part) => normaliseIngredient(part.replace(STRENGTH_OR_FORM, " ")))
    .filter((p) => p.length > 0);
  return [...new Set(parts)].sort();
}

export interface IngredientItem {
  /** Any stable id for the medicine (a medication id, or "candidate"). */
  id: string;
  /** The generic name, or the typed name when nothing better is known. Combination products list every ingredient. */
  generic: string;
}

export interface DuplicateIngredientPair {
  /** The two medicine ids, `a` before `b` in plain code-unit order. */
  a: string;
  b: string;
  /** The ingredients the two share, sorted. */
  shared: string[];
}

/** Every pair of different medicines that name at least one ingredient in common. Sorted by `a` then `b`. */
export function findDuplicateIngredients(items: readonly IngredientItem[]): DuplicateIngredientPair[] {
  const prepared = items
    .map((i) => ({ id: i.id, set: new Set(splitIngredients(i.generic)) }))
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const out: DuplicateIngredientPair[] = [];
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      if (prepared[i].id === prepared[j].id) continue;
      const shared = [...prepared[i].set].filter((x) => prepared[j].set.has(x)).sort();
      if (shared.length > 0) out.push({ a: prepared[i].id, b: prepared[j].id, shared });
    }
  }
  return out;
}
