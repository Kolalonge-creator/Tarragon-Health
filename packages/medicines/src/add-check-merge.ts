import type { AddCheckFinding, AddCheckKind } from "./add-check";
import { normaliseIngredient } from "./ingredients";
import type { DrugSafetySeverity } from "./safety/drug-safety";

/**
 * One warning per pair of medicines (S08y follow-up, 2026-11-03).
 *
 * Two checks run when a medicine is added: the S53 class-pair dataset (`checkMedicineOnAdd`, kinds `interaction` and `duplicate`)
 * and the S08y ingredient layer (`checkIngredientsOnAdd`, kinds `rule` and `same_ingredient`). Once both are signed and open they
 * fire on the SAME pair for the common cases: an ACE inhibitor with an ARB is class pair 1 in S53 and `p01_lisinopril_losartan`
 * in the rule set, so a patient adding losartan to lisinopril would read two near-identical warnings about one pair. This merges
 * them so that, per family (interaction: `interaction` or `rule`; duplicate: `duplicate` or `same_ingredient`), a pair is warned
 * about once.
 *
 * Shapes differ: an S08y finding always names exactly the new medicine and one other; an S53 finding names every medicine in
 * the group it matched, so with two ACE inhibitors already on the list it names three medicines and stands for two pairs
 * (new + each other). Its twins are therefore the S08y findings of the same family whose other medicine it names.
 *
 * Which survives: the higher severity. On a tie the S08y findings win, because they carry a named ingredient pair and a cited
 * source the Chief Medical Officer signed line by line, and their sentence says so. An S53 finding is dropped only when its
 * twins cover every pair it stands for; with partial cover (a rule exists for one of its medicines but not the other) it is
 * kept, together with any twin that is at least as severe, so no pair loses its warning.
 *
 * Nothing is weakened: a warning never disappears for a pair, only its twin does; a pair only one check knows is untouched;
 * findings about different pairs are never merged; the output is worst first.
 */
const RANK: Record<DrugSafetySeverity, number> = { contraindicated: 0, caution: 1, info: 2 };

type Family = "interaction" | "duplicate";

const FAMILY: Record<AddCheckKind, Family> = {
  interaction: "interaction",
  rule: "interaction",
  duplicate: "duplicate",
  same_ingredient: "duplicate",
};

/** The S08y ingredient-level kinds, which name exactly one pair and win a severity tie. */
const PAIRWISE: ReadonlySet<AddCheckKind> = new Set<AddCheckKind>(["rule", "same_ingredient"]);

/** The medicines a finding names other than the one being added, as normalised names (the new one may be absent from a malformed finding). */
function others(f: AddCheckFinding, candidate: string): string[] {
  return [...new Set(f.drugNames.map(normaliseIngredient).filter((n) => n !== candidate))];
}

function worstFirst(a: AddCheckFinding, b: AddCheckFinding): number {
  return RANK[a.severity] - RANK[b.severity];
}

/**
 * Collapse the S53 and S08y findings for one add so a person reads one warning per pair per family, worst first. Pure; the input
 * is not changed. `candidateName` is the name typed for the new medicine, exactly as both checks received it.
 */
export function mergeAddFindings(findings: readonly AddCheckFinding[], candidateName: string): AddCheckFinding[] {
  const candidate = normaliseIngredient(candidateName);
  // S08y findings, keyed by family and the other medicine. A repeat of the same key keeps the more severe one.
  const pairwise = new Map<string, AddCheckFinding>();
  const grouped: AddCheckFinding[] = [];
  for (const f of findings) {
    if (!PAIRWISE.has(f.kind)) {
      grouped.push(f);
      continue;
    }
    const key = `${FAMILY[f.kind]}|${others(f, candidate).join("|")}`;
    const current = pairwise.get(key);
    if (current === undefined || worstFirst(f, current) < 0) pairwise.set(key, f);
  }

  const survivors = new Set<AddCheckFinding>(pairwise.values());
  for (const f of grouped) {
    const pairs = others(f, candidate);
    const twins = pairs.map((o) => pairwise.get(`${FAMILY[f.kind]}|${o}`)).filter((t): t is AddCheckFinding => t !== undefined);
    if (twins.length === 0) {
      survivors.add(f);
    } else if (twins.every((t) => worstFirst(f, t) < 0)) {
      // The class warning says more than any of its twins: it stays and the twins go.
      for (const t of twins) survivors.delete(t);
      survivors.add(f);
    } else if (twins.length < pairs.length) {
      // Partial cover: keep the class warning for the uncovered pair, and keep only the twins that are at least as severe.
      for (const t of twins) if (worstFirst(f, t) < 0) survivors.delete(t);
      survivors.add(f);
    }
    // Otherwise every pair it stands for has an S08y warning at least as severe: the twins say it, pair by pair, with a cited source.
  }
  // Input order is kept between findings of one severity (the sort is stable), so the two surfaces agree on what comes first.
  return findings.filter((f) => survivors.has(f)).sort(worstFirst);
}
