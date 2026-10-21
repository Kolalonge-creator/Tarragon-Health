/**
 * S47a: plausibility limits for every observation a person can log by hand (BUILD-SPEC-v5 4.3, 4.7).
 *
 * HARD limits are typo gates. They are deliberately wider than any clinical band (a true severe low or a crisis-range reading must always be
 * enterable so the red-flag engines can escalate it), so only a number no live human could produce is refused, and it is refused with a plain
 * message that says what to check. SOFT limits (new lifestyle types only) never refuse: they ask the person to confirm the number.
 *
 * The database mirrors the hard limits for the three lifestyle types and the inhaler log in a CHECK constraint
 * (supabase/migrations/*_s47a_b_*.sql); observation-limits-mirror.test.ts fails if the two drift. The phone bundles this value, so a
 * limit works with no signal. Status is PROPOSED: the Chief Medical Officer confirms by publishing a higher version
 * (observation_limit_signoffs, sign_observation_limits).
 */
export const OBSERVATION_LIMITS_V1 = {
  glucose_mmol_l: { min: 1, max: 40, unit: "mmol/L", integer: false },
  glucose_mg_dl: { min: 18, max: 720, unit: "mg/dL", integer: false },
  weight_kg: { min: 20, max: 300, unit: "kg", integer: false },
  waist_cm: { min: 40, max: 200, unit: "cm", integer: false },
  temperature_c: { min: 30, max: 45, unit: "C", integer: false },
  spo2_pct: { min: 50, max: 100, unit: "%", integer: true },
  pulse_bpm: { min: 20, max: 300, unit: "bpm", integer: true },
  systolic_mmhg: { min: 60, max: 260, unit: "mmHg", integer: true },
  diastolic_mmhg: { min: 30, max: 160, unit: "mmHg", integer: true },
  water_ml: { min: 10, max: 3000, unit: "ml", integer: true, softMax: 1500 },
  sleep_hours: { min: 0.5, max: 24, unit: "h", integer: false, softMin: 2, softMax: 14 },
  mood: { min: 1, max: 5, unit: "score", integer: true },
  inhaler_puffs: { min: 1, max: 20, unit: "puffs", integer: true, softMax: 8 },
} as const;

export type ObservationLimitKey = keyof typeof OBSERVATION_LIMITS_V1;
