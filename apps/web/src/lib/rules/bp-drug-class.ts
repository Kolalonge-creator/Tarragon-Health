/**
 * HEARTS antihypertensive drug-class classifier — TS mirror of the DB
 * `private.bp_drug_class` (migration bp_drug_ladder_and_safety). Used by the
 * clinician ladder panel to infer where a patient sits on the stepped ladder.
 * Keep in lock-step with the SQL patterns; the tests pin them.
 */
export type BpDrugClass = "acei" | "arb" | "ccb" | "thiazide" | "k_sparing" | null;

export function bpDrugClass(name: string | null | undefined): BpDrugClass {
  if (!name) return null;
  const n = name.toLowerCase();
  if (/(losartan|telmisartan|valsartan|irbesartan|candesartan|olmesartan|azilsartan)/.test(n)) return "arb";
  if (/(ramipril|lisinopril|enalapril|perindopril|captopril|benazepril|fosinopril|quinapril)/.test(n)) return "acei";
  if (/(amlodipine|nifedipine|felodipine|lercanidipine|nitrendipine)/.test(n)) return "ccb";
  if (/(hydrochlorothiazide|hctz|indapamide|bendroflumethiazide|chlortalidone|chlorthalidone)/.test(n)) return "thiazide";
  if (/(spironolactone|amiloride|eplerenone|moduretic)/.test(n)) return "k_sparing";
  return null;
}

/**
 * Coarse current-step inference from the classes of a patient's active BP meds
 * (Nigeria HEARTS ladder, §12.3). Decision SUPPORT only — the doctor decides;
 * dose-level up-titration (step 2 vs 3) isn't inferable from class alone.
 */
export function inferBpLadderStep(drugNames: readonly (string | null | undefined)[]): number {
  const classes = new Set(drugNames.map(bpDrugClass).filter((c): c is Exclude<BpDrugClass, null> => c != null));
  const hasRas = classes.has("arb") || classes.has("acei");
  if (classes.has("k_sparing")) return 5; // resistant / specialist add-on
  if (classes.has("ccb") && hasRas && classes.has("thiazide")) return 4;
  if (classes.has("ccb") && hasRas) return 3; // step 2 or 3 (dose-dependent)
  if (classes.has("ccb") || hasRas) return 1;
  return 0; // no antihypertensive on record
}
