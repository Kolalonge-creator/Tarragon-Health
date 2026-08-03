/**
 * eGFR from the patient's own creatinine — CKD-EPI 2021 (race-free).
 *
 * PURE function, no I/O, so it is unit-testable and stays the single source of
 * truth. This is the input the drug-safety engine has always needed and never
 * had: until creatinine could be captured as a number (lib/lab-reports), every
 * renal-dosing rule on this platform was inert because `egfr` was always null.
 *
 * WHICH EQUATION AND WHY: CKD-EPI 2021 is the race-free refit. The original
 * 2009 CKD-EPI applied a +15.9% multiplier to Black patients, which inflates
 * eGFR — in a Nigerian population that would systematically over-estimate
 * kidney function and under-warn on exactly the drugs this platform checks
 * (metformin, ACE inhibitors, NSAIDs). The 2021 equation removes the race
 * coefficient entirely. It is the current KDIGO-endorsed adult equation.
 *
 * HONEST LIMITS, stated rather than buried:
 * - Adults only (18+). Paediatric eGFR needs a different equation (Schwartz),
 *   which this file deliberately does not implement rather than mis-apply.
 * - A single creatinine estimates STEADY-STATE function. In acute kidney injury
 *   creatinine lags, so an eGFR from one reading can read falsely reassuring.
 *   `estimateEgfr` therefore reports staleness, and callers surface it.
 * - CKD staging requires the abnormality to persist over 3 months. A single
 *   reading gives a CKD-EPI *value*, not a diagnosis of CKD. `ckdStage` is
 *   labelled a GFR category for that reason, never "the patient has CKD".
 */

export type Sex = "male" | "female";

export interface EgfrInput {
  /** Serum creatinine in mg/dL (the catalogue's canonical unit for `creatinine`). */
  creatinineMgDl: number;
  ageYears: number;
  sex: Sex;
}

/** GFR categories G1–G5, per KDIGO. A category, not a diagnosis. */
export type GfrCategory = "G1" | "G2" | "G3a" | "G3b" | "G4" | "G5";

export interface EgfrResult {
  /** mL/min/1.73m², rounded to a whole number as reported clinically. */
  egfr: number;
  category: GfrCategory;
  categoryLabel: string;
  equation: "CKD-EPI 2021 (race-free)";
}

/**
 * CKD-EPI 2021:
 *   eGFR = 142 × min(Scr/κ, 1)^α × max(Scr/κ, 1)^-1.200 × 0.9938^age × (1.012 if female)
 * with κ = 0.7 (female) / 0.9 (male), α = -0.241 (female) / -0.302 (male).
 *
 * Returns null rather than a number when the inputs cannot support an honest
 * estimate — a wrong eGFR is far worse than no eGFR, because every renal rule
 * downstream trusts it.
 */
export function estimateEgfr(input: EgfrInput): EgfrResult | null {
  const { creatinineMgDl, ageYears, sex } = input;

  if (!Number.isFinite(creatinineMgDl) || creatinineMgDl <= 0) return null;
  if (!Number.isFinite(ageYears) || ageYears < 18 || ageYears > 120) return null;
  // Outside this band the value is far more likely a unit error than a real
  // creatinine, and the catalogue's plausibility guard should already have
  // caught it. Refusing here is the second line of that defence.
  if (creatinineMgDl < 0.1 || creatinineMgDl > 25) return null;

  const kappa = sex === "female" ? 0.7 : 0.9;
  const alpha = sex === "female" ? -0.241 : -0.302;
  const ratio = creatinineMgDl / kappa;

  const egfrRaw =
    142 *
    Math.pow(Math.min(ratio, 1), alpha) *
    Math.pow(Math.max(ratio, 1), -1.2) *
    Math.pow(0.9938, ageYears) *
    (sex === "female" ? 1.012 : 1);

  if (!Number.isFinite(egfrRaw) || egfrRaw <= 0) return null;

  const egfr = Math.round(egfrRaw);
  const category = gfrCategory(egfr);
  return {
    egfr,
    category,
    categoryLabel: GFR_CATEGORY_LABEL[category],
    equation: "CKD-EPI 2021 (race-free)",
  };
}

export const GFR_CATEGORY_LABEL: Record<GfrCategory, string> = {
  G1: "Normal or high (≥90)",
  G2: "Mildly reduced (60–89)",
  G3a: "Mild to moderately reduced (45–59)",
  G3b: "Moderately to severely reduced (30–44)",
  G4: "Severely reduced (15–29)",
  G5: "Kidney failure (<15)",
};

export function gfrCategory(egfr: number): GfrCategory {
  if (egfr >= 90) return "G1";
  if (egfr >= 60) return "G2";
  if (egfr >= 45) return "G3a";
  if (egfr >= 30) return "G3b";
  if (egfr >= 15) return "G4";
  return "G5";
}

export interface EgfrFromReadingInput {
  creatinineMgDl: number;
  /** When the creatinine sample was taken. Drives the staleness flag. */
  takenAt: string | Date;
  dateOfBirth: string | Date;
  sex: string | null | undefined;
  /** Injectable for deterministic tests. */
  now?: Date;
}

export interface EgfrWithProvenance extends EgfrResult {
  takenAt: string;
  ageAtTest: number;
  /** Days between the creatinine sample and `now`. */
  ageOfResultDays: number;
  /**
   * True when the creatinine is over a year old. A renal dosing decision on a
   * stale creatinine is a real hazard, so this is surfaced beside the number
   * rather than left for the reader to work out from the date.
   */
  stale: boolean;
}

/**
 * Convenience wrapper for the real call site: a stored `lab_analyte_readings`
 * creatinine row plus the patient's demographics. Returns null when the patient
 * is under 18, sex is unknown, or the value cannot support an estimate — every
 * caller treats null as "we do not know", never as "normal".
 */
export function egfrFromReading(input: EgfrFromReadingInput): EgfrWithProvenance | null {
  const sex = input.sex === "male" || input.sex === "female" ? input.sex : null;
  if (!sex) return null;

  const now = input.now ?? new Date();
  const takenAt = new Date(input.takenAt);
  const dob = new Date(input.dateOfBirth);
  if (Number.isNaN(takenAt.getTime()) || Number.isNaN(dob.getTime())) return null;

  // Age AT THE TIME OF THE TEST, not today — for an old creatinine those differ,
  // and the equation is age-sensitive.
  const ageAtTest = Math.floor(
    (takenAt.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000),
  );

  const result = estimateEgfr({ creatinineMgDl: input.creatinineMgDl, ageYears: ageAtTest, sex });
  if (!result) return null;

  const ageOfResultDays = Math.max(
    0,
    Math.floor((now.getTime() - takenAt.getTime()) / (24 * 60 * 60 * 1000)),
  );

  return {
    ...result,
    takenAt: takenAt.toISOString(),
    ageAtTest,
    ageOfResultDays,
    stale: ageOfResultDays > 365,
  };
}
