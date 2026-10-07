import { CLASS_LABEL, INTERACTION_RULES, type TherapeuticClass } from "./drug-safety";

/**
 * The interaction and duplication dataset, as DATA (spec 8.7, S53, decision D6).
 *
 * The rules the add check runs live in `drug-safety.ts`. This module turns that same list into rows a human can read, sign, and
 * the database can hold. A test (`interaction-dataset.test.ts`) fails if the checked-in seed file ever differs from what the code
 * runs, so a rule cannot change without the file, its content hash and the sign-off summary changing with it.
 *
 * NOTHING IN THIS FILE SIGNS ANYTHING. A dataset is a draft until the Chief Medical Officer (with a pharmacist's review) signs it
 * through `public.sign_interaction_dataset`. Until then the go-live guard `interaction_check_enabled` stays off.
 */

export interface DatasetRule {
  rule_code: string;
  kind: "interaction" | "duplicate";
  drug_a: string;
  drug_b: string;
  severity: "contraindicated" | "caution" | "info";
  advice_key: string;
  title: string;
  source: string;
}

export const DATASET_VERSION = 1;

const GENERIC_SOURCE =
  "Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.";

/** Sources named for a few rules whose evidence is widely known. The reviewer still confirms each one. */
const SPECIFIC_SOURCE: Record<string, string> = {
  ace_inhibitor__arb:
    "ONTARGET trial (N Engl J Med 2008;358:1547-59) showed more kidney injury and high potassium with ACE inhibitor plus ARB; BNF Appendix 1. Reviewer to confirm.",
  statin__macrolide:
    "Simvastatin and atorvastatin labelling and MHRA drug safety advice on clarithromycin and erythromycin with statins; BNF Appendix 1. Reviewer to confirm.",
  beta_blocker__ccb_non_dihydropyridine:
    "Verapamil and diltiazem product labelling (caution with beta blockers); BNF Appendix 1. Reviewer to confirm.",
  nsaid__anticoagulant: "BNF Appendix 1 (NSAIDs with anticoagulants); warfarin and DOAC labelling. Reviewer to confirm.",
};

const EXPECTED_MULTIPLES: TherapeuticClass[] = ["insulin", "antiplatelet"];

function adviceKey(kind: "interaction" | "duplicate", severity: DatasetRule["severity"]): string {
  if (kind === "duplicate") return "medicines.addcheck.advice.duplicate";
  if (severity === "contraindicated") return "medicines.addcheck.advice.high";
  if (severity === "caution") return "medicines.addcheck.advice.review";
  return "medicines.addcheck.advice.note";
}

export function buildDataset(): DatasetRule[] {
  const rules: DatasetRule[] = [];
  const seen = new Set<string>();
  for (const r of INTERACTION_RULES) {
    // Pairs are written once per direction in some rules (for example ACE inhibitor and ARB with a potassium-sparing diuretic);
    // the key is the ordered class pair and the title, so two different rules for one pair both survive.
    let code = `${r.a}__${r.b}`;
    if (seen.has(code)) code = `${code}__${r.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
    seen.add(code);
    rules.push({
      rule_code: code,
      kind: "interaction",
      drug_a: r.a,
      drug_b: r.b,
      severity: r.severity,
      advice_key: adviceKey("interaction", r.severity),
      title: r.title,
      source: SPECIFIC_SOURCE[`${r.a}__${r.b}`] ?? GENERIC_SOURCE,
    });
  }
  for (const cls of Object.keys(CLASS_LABEL) as TherapeuticClass[]) {
    const expected = EXPECTED_MULTIPLES.includes(cls);
    const severity: DatasetRule["severity"] = expected ? "caution" : "contraindicated";
    rules.push({
      rule_code: `duplicate__${cls}`,
      kind: "duplicate",
      drug_a: cls,
      drug_b: cls,
      severity,
      advice_key: adviceKey("duplicate", severity),
      title: `Two ${CLASS_LABEL[cls]} medicines at the same time`,
      source: expected
        ? "Duplicate-therapy check. Two of this kind are sometimes deliberate, so a warning is raised only when the prescribers differ. Reviewer to confirm."
        : "Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.",
    });
  }
  return rules.sort((a, b) => (a.rule_code < b.rule_code ? -1 : a.rule_code > b.rule_code ? 1 : 0));
}

/** The text hashed for the sign-off. Same fields, same order, as `private.interaction_dataset_hash` in the database. */
export function canonicalDatasetText(rules: readonly DatasetRule[]): string {
  return [...rules]
    .sort((a, b) => (a.rule_code < b.rule_code ? -1 : a.rule_code > b.rule_code ? 1 : 0))
    .map((r) => [r.rule_code, r.kind, r.drug_a, r.drug_b, r.severity, r.advice_key, r.title, r.source].join("|"))
    .join("\n");
}
