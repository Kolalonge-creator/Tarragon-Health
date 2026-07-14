import { hba1cPercentToMmolMol } from "@tarragon/shared";

/**
 * WHO HbA1c bands, shared wherever a real HbA1c % value is displayed (not
 * a normalized sub-score) — Health Passport, the patient trend chart, the
 * Health Score card's HbA1c component row. Matches the exact thresholds
 * lib/rules/health-score.ts's hba1cSubScore already uses internally, kept
 * here as the single source of truth so both stay in sync.
 */

export interface Hba1cBracket {
  label: "Normal" | "Prediabetic range" | "Diabetic range";
}

export function getHba1cBracket(value: number): Hba1cBracket {
  if (value < 5.7) return { label: "Normal" };
  if (value < 6.5) return { label: "Prediabetic range" };
  return { label: "Diabetic range" };
}

/**
 * "41 mmol/mol (5.9%, Prediabetic range)" — mmol/mol (IFCC) is the value
 * lab_analyte_readings itself never stores (it's always NGSP %), so this
 * is a display-only conversion via the fixed NGSP<->IFCC master equation,
 * not a second unit the platform tracks independently.
 */
export function formatHba1cWithBracket(value: number): string {
  const mmolMol = hba1cPercentToMmolMol(value);
  return `${mmolMol} mmol/mol (${value}%, ${getHba1cBracket(value).label})`;
}
