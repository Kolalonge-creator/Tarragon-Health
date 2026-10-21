import { CANDIDATE_ID, type AddCheckFinding, type AddCheckResult } from "./add-check";
import { resolveGeneric, type BrandMapEntry } from "./brand-map";
import type { CatalogueEntry } from "./catalogue";
import { findDuplicateIngredients, type IngredientItem } from "./ingredients";
import { checkInteractionRules, type IngredientRule } from "./interaction-rules";
import type { DrugSafetySeverity } from "./safety/drug-safety";

/**
 * The S08y checks that run when a medicine is added, next to the S53 class check: the same ingredient under two names, and the
 * governed interaction rules. Pure and offline, warn only, and a clean result never means "safe" (`complete: false`).
 *
 * `duplicateCheck` is the go-live switch for the same-ingredient warning and `rules` is the active SIGNED rule set (empty when
 * none is signed or the switch is closed). The caller reads both; this function does not, so with both closed it returns nothing.
 */
export interface IngredientCheckInput {
  candidateName: string;
  existing: readonly { id: string; drugName: string }[];
  /** Brand rows as read; only reviewed, active rows with a citation are used. */
  brandMap: readonly BrandMapEntry[];
  catalogue: readonly CatalogueEntry[];
  duplicateCheck: boolean;
  rules: readonly IngredientRule[];
}

const RANK: Record<DrugSafetySeverity, number> = { contraindicated: 0, caution: 1, info: 2 };

export function checkIngredientsOnAdd(input: IngredientCheckInput): AddCheckResult {
  const base: AddCheckResult = { findings: [], isAdvisoryOnly: true, complete: false, changesAnything: false };
  const name = input.candidateName.trim();
  if (name.length === 0) return base;

  const names = new Map<string, string>([[CANDIDATE_ID, name]]);
  for (const e of input.existing) names.set(e.id, e.drugName);
  const items: IngredientItem[] = [...names.entries()].map(([id, drug]) => ({
    id,
    generic: resolveGeneric(drug, input.brandMap, input.catalogue),
  }));
  const label = (id: string) => names.get(id) as string;

  const findings: AddCheckFinding[] = [];
  if (input.duplicateCheck) {
    for (const pair of findDuplicateIngredients(items)) {
      if (pair.a !== CANDIDATE_ID && pair.b !== CANDIDATE_ID) continue;
      findings.push({
        kind: "same_ingredient",
        severity: "caution",
        drugNames: [label(pair.a), label(pair.b)],
        adviceKey: "medicines.addcheck.advice.same_ingredient",
      });
    }
  }
  for (const f of checkInteractionRules(input.rules, items, CANDIDATE_ID).findings) {
    findings.push({ kind: "rule", severity: f.severity, drugNames: f.medicineIds.map(label), adviceKey: f.adviceKey });
  }
  findings.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  return { ...base, findings };
}
