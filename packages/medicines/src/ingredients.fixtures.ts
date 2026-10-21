/**
 * Shared cases for the duplicate-ingredient rule. `findDuplicateIngredients` runs them in `ingredients.test.ts`; the database
 * proof (packages/db/tests/s08y_medicine_safety.sql) runs the same names through `private.duplicate_ingredient_pairs`, and a
 * test fails if a case name here is missing from that proof. `pairs` lists "a|b|shared1,shared2".
 *
 * The generic names below are ordinary, widely known ingredient names used only to exercise string matching. They are not
 * clinical content and carry no claim about any interaction.
 */
export interface IngredientCase {
  name: string;
  items: { id: string; generic: string }[];
  pairs: string[];
}

export const INGREDIENT_CASES: IngredientCase[] = [
  { name: "no medicines", items: [], pairs: [] },
  { name: "one medicine alone", items: [{ id: "a", generic: "Paracetamol" }], pairs: [] },
  { name: "same generic twice", items: [{ id: "a", generic: "Paracetamol" }, { id: "b", generic: "paracetamol" }], pairs: ["a|b|paracetamol"] },
  { name: "different medicines", items: [{ id: "a", generic: "Paracetamol" }, { id: "b", generic: "Ibuprofen" }], pairs: [] },
  {
    name: "combination shares one ingredient",
    items: [{ id: "a", generic: "Amoxicillin" }, { id: "b", generic: "Amoxicillin and clavulanic acid" }],
    pairs: ["a|b|amoxicillin"],
  },
  {
    name: "two combinations share both",
    items: [{ id: "a", generic: "Amoxicillin and clavulanic acid" }, { id: "b", generic: "Clavulanic acid / Amoxicillin" }],
    pairs: ["a|b|amoxicillin,clavulanic acid"],
  },
  {
    name: "order of the list does not matter",
    items: [{ id: "z", generic: "Paracetamol + caffeine" }, { id: "m", generic: "Caffeine" }, { id: "a", generic: "Paracetamol" }],
    pairs: ["a|z|paracetamol", "m|z|caffeine"],
  },
  { name: "punctuation and case are ignored", items: [{ id: "a", generic: "PARA-CETAMOL" }, { id: "b", generic: "para cetamol" }], pairs: ["a|b|para cetamol"] },
  { name: "a salt name is not matched", items: [{ id: "a", generic: "Amlodipine besylate" }, { id: "b", generic: "Amlodipine" }], pairs: [] },
  { name: "the same id twice is not a pair", items: [{ id: "a", generic: "Paracetamol" }, { id: "a", generic: "Paracetamol" }], pairs: [] },
  {
    name: "a strength and a dose form typed after the name are ignored",
    items: [{ id: "a", generic: "Lisinopril 10mg tablets" }, { id: "b", generic: "lisinopril" }, { id: "c", generic: "Lisinopril 0.5 g" }],
    pairs: ["a|b|lisinopril", "a|c|lisinopril", "b|c|lisinopril"],
  },
  {
    name: "a strength alone is not an ingredient",
    items: [{ id: "a", generic: "Paracetamol 500 mg/5 ml" }, { id: "b", generic: "Ibuprofen 500 mg/5 ml" }],
    pairs: [],
  },
  { name: "blank names match nothing", items: [{ id: "a", generic: "  " }, { id: "b", generic: "" }], pairs: [] },
];
