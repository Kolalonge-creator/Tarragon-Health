import { assessMedicationSafety, type DrugSafetySeverity, type MedicationInput } from "./safety/drug-safety";

/**
 * The check that runs when a medicine is added (spec 8.7, S53): interactions and duplicate therapy against what the person
 * already takes.
 *
 * DESIGN, stated once because it is the whole safety case:
 *   * It is a pure function in the shared package, so the phone and the web run the SAME check, offline, with no health data
 *     sent to a server and no language model anywhere near it.
 *   * It uses the curated rule set in `safety/drug-safety.ts`, which is a hand-checked list for the medicines this platform
 *     sees. It is NOT a complete interaction database. A clean result means "nothing in this list fired", never "safe";
 *     `isAdvisoryOnly` and `complete: false` are in the type so no screen can quietly drop that.
 *   * It NEVER changes anything: it returns words. It cannot stop, remove, edit or block a medicine, and the patient-facing
 *     advice is always "contact your care team" and "do not stop a prescribed medicine on your own".
 *   * The clinician-facing rule text (which says things like "stop one of them") is deliberately NOT passed through. A patient
 *     gets a fixed, reviewed sentence chosen by severity; the clinician panel keeps the full text.
 *   * The whole feature is behind the go-live guard `interaction_check_enabled`, which stays off until a human-signed dataset
 *     exists (D6). The caller asks the guard; this function does not.
 */

export type AddCheckKind = "interaction" | "duplicate";

export type AddCheckAdviceKey =
  | "medicines.addcheck.advice.high"
  | "medicines.addcheck.advice.review"
  | "medicines.addcheck.advice.note"
  | "medicines.addcheck.advice.duplicate";

export interface AddCheckFinding {
  kind: AddCheckKind;
  severity: DrugSafetySeverity;
  /** Names exactly as the person recorded them, the new one included. */
  drugNames: string[];
  /** i18n key of the fixed patient-facing sentence. */
  adviceKey: AddCheckAdviceKey;
}

export interface AddCheckResult {
  findings: AddCheckFinding[];
  /** Always true: the check only advises. */
  isAdvisoryOnly: true;
  /** Always false: a curated list, not a complete database. */
  complete: false;
  /** Always false: nothing here stops or changes a medicine. */
  changesAnything: false;
}

export const CANDIDATE_ID = "__candidate__";

const SEVERITY_RANK: Record<DrugSafetySeverity, number> = { contraindicated: 0, caution: 1, info: 2 };

function adviceFor(kind: AddCheckKind, severity: DrugSafetySeverity): AddCheckAdviceKey {
  if (kind === "duplicate") return "medicines.addcheck.advice.duplicate";
  if (severity === "contraindicated") return "medicines.addcheck.advice.high";
  if (severity === "caution") return "medicines.addcheck.advice.review";
  return "medicines.addcheck.advice.note";
}

/**
 * Check one medicine about to be added against the ones already on the list. Only findings that involve the new medicine are
 * returned (what is already wrong with the existing list is the clinician panel's job, not this prompt's).
 */
export function checkMedicineOnAdd(candidateName: string, existing: readonly MedicationInput[]): AddCheckResult {
  const name = candidateName.trim();
  const base: AddCheckResult = { findings: [], isAdvisoryOnly: true, complete: false, changesAnything: false };
  if (name.length === 0) return base;

  const candidate: MedicationInput = { id: CANDIDATE_ID, drugName: name, source: "patient" };
  const report = assessMedicationSafety([...existing, candidate]);
  const findings: AddCheckFinding[] = [];
  for (const f of report.findings) {
    if (f.kind !== "interaction" && f.kind !== "duplicate_therapy") continue;
    if (!f.medicationIds.includes(CANDIDATE_ID)) continue;
    const kind: AddCheckKind = f.kind === "duplicate_therapy" ? "duplicate" : "interaction";
    findings.push({ kind, severity: f.severity, drugNames: f.drugNames, adviceKey: adviceFor(kind, f.severity) });
  }
  findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return { ...base, findings };
}

/**
 * The same patient-safe wording for the list a person already has (the note above their medicines). Interactions and duplicate
 * therapy only: the engine's other findings (dosing, allergy, drug-specific) are written for clinicians and are not shown here.
 */
export function checkMedicineList(medications: readonly MedicationInput[]): AddCheckFinding[] {
  const report = assessMedicationSafety([...medications]);
  const findings: AddCheckFinding[] = [];
  for (const f of report.findings) {
    if (f.kind !== "interaction" && f.kind !== "duplicate_therapy") continue;
    const kind: AddCheckKind = f.kind === "duplicate_therapy" ? "duplicate" : "interaction";
    findings.push({ kind, severity: f.severity, drugNames: f.drugNames, adviceKey: adviceFor(kind, f.severity) });
  }
  return findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
