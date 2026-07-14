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

/** "5.9% (Prediabetic range)" — the exact "real value with bracket" format requested. */
export function formatHba1cWithBracket(value: number): string {
  return `${value}% (${getHba1cBracket(value).label})`;
}
