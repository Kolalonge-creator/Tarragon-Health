/**
 * WHO/ISH-style 10-year CVD risk estimate for the AFRO region (§9).
 *
 * DECISION SUPPORT / ESTIMATE ONLY. This is a transparent, lab-optional
 * rule-based approximation of the WHO/ISH AFRO risk chart, intended to give the
 * doctor a risk band at the point of care when the Tarragon ML SCORE2 service
 * is unavailable and without requiring bloods. It is NOT the official chart and
 * NOT a substitute for clinical judgement — the doctor confirms the band. Bands
 * follow WHO's categories (<10%, 10–<20%, 20–<30%, ≥30%).
 */
export type CvdRiskBand = "low" | "moderate" | "high" | "very_high" | "insufficient";

export interface CvdRiskInput {
  age: number | null | undefined;
  sex: "male" | "female" | null | undefined;
  smoker: boolean | null | undefined;
  diabetic: boolean | null | undefined;
  systolic: number | null | undefined;
  totalCholesterolMmol?: number | null; // optional — lab-free estimate still works
}

export interface CvdRiskResult {
  band: CvdRiskBand;
  points: number;
  labUsed: boolean;
  label: string;
}

const BAND_LABEL: Record<CvdRiskBand, string> = {
  low: "Low (<10%)",
  moderate: "Moderate (10–<20%)",
  high: "High (20–<30%)",
  very_high: "Very high (≥30%)",
  insufficient: "Insufficient data",
};

/**
 * Monotonic points model: risk rises with age, male sex, smoking, diabetes,
 * systolic BP and (if known) cholesterol. Thresholds tuned so that a young
 * non-smoker sits low and an older diabetic smoker with high SBP sits very high,
 * matching the shape of the WHO/ISH AFRO chart.
 */
export function estimateCvdRiskBand(input: CvdRiskInput): CvdRiskResult {
  const { age, sex, smoker, diabetic, systolic } = input;
  if (age == null || systolic == null || sex == null) {
    return { band: "insufficient", points: 0, labUsed: false, label: BAND_LABEL.insufficient };
  }

  let points = 0;
  if (age >= 70) points += 5;
  else if (age >= 60) points += 4;
  else if (age >= 50) points += 3;
  else if (age >= 40) points += 2;
  else points += 0;

  if (sex === "male") points += 1;
  if (smoker) points += 2;
  if (diabetic) points += 2;

  if (systolic >= 180) points += 4;
  else if (systolic >= 160) points += 3;
  else if (systolic >= 140) points += 2;
  else if (systolic >= 120) points += 1;

  let labUsed = false;
  const chol = input.totalCholesterolMmol;
  if (chol != null) {
    labUsed = true;
    if (chol >= 8) points += 3;
    else if (chol >= 6) points += 2;
    else if (chol >= 5) points += 1;
  }

  let band: CvdRiskBand;
  if (points >= 11) band = "very_high";
  else if (points >= 8) band = "high";
  else if (points >= 5) band = "moderate";
  else band = "low";

  return { band, points, labUsed, label: BAND_LABEL[band] };
}
