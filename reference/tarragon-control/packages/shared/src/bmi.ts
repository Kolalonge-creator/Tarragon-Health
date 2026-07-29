/**
 * Spec §8: "Measurement capture: BP ×2 ..., glucose, height, weight,
 * waist. Auto-computes BMI." There is no `bmi` reading_type -- height and
 * weight are captured as two separate readings (see spec §5.1's
 * reading_type enum), so BMI is a display-time computation over the
 * pair, not its own stored fact. Deliberately not persisted as a
 * synthetic reading row: that would misrepresent a derived number as
 * something someone measured.
 */
export function computeBmi(heightCm: number, weightKg: number): number {
  if (heightCm <= 0) {
    throw new Error(`computeBmi: heightCm must be > 0, got ${heightCm}`);
  }
  if (weightKg <= 0) {
    throw new Error(`computeBmi: weightKg must be > 0, got ${weightKg}`);
  }

  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
}

export type BmiBand = "underweight" | "normal" | "overweight" | "obese";

/** WHO standard adult BMI bands (kg/m²), used for the on-device instant
 * result card's plain-language band (spec §8). */
export function classifyBmiBand(bmi: number): BmiBand {
  if (bmi < 18.5) return "underweight";
  if (bmi < 25) return "normal";
  if (bmi < 30) return "overweight";
  return "obese";
}
