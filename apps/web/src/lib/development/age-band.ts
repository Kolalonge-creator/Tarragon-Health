/**
 * Client-side mirror of the six age bands seeded in
 * developmental_questionnaire_items (20260829122052_pediatric_developmental_screening.sql)
 * — used only to pick which item set to SHOW before submitting. The database
 * trigger (private.score_developmental_screening) recomputes age and band
 * server-side from the patient's own date_of_birth and is the authority; if
 * this ever drifts from the seeded bands, the server-side value wins.
 */
export const DEVELOPMENTAL_AGE_BANDS = [
  { min: 4, max: 8 },
  { min: 9, max: 15 },
  { min: 16, max: 23 },
  { min: 24, max: 35 },
  { min: 36, max: 47 },
  { min: 48, max: 60 },
] as const;

export type DevelopmentalDomain = "motor" | "language" | "social" | "cognitive" | "behavioural";

export const DEVELOPMENTAL_DOMAINS: DevelopmentalDomain[] = [
  "motor",
  "language",
  "social",
  "cognitive",
  "behavioural",
];

export const DEVELOPMENTAL_DOMAIN_LABEL: Record<DevelopmentalDomain, string> = {
  motor: "Motor",
  language: "Language",
  social: "Social",
  cognitive: "Cognitive",
  behavioural: "Behavioural",
};

/** Deliberately mirrors private.score_developmental_screening's own
 * `floor((screening_date - dob) / 30.4375)` exactly (average-day-length
 * division, not calendar-exact whole months) — NOT for numerical purity, but
 * so the item set this fetches client-side is guaranteed to be the same age
 * band the server will compute and score against. A calendar-accurate
 * "months old" here would silently drift from the server's band at a
 * boundary (e.g. exactly 2 years old can read as 23 months under this
 * approximation) and submit responses keyed to items the server-computed
 * band doesn't contain, scoring as empty. If the server-side formula ever
 * changes, this must change with it. */
export function ageMonthsFromDateOfBirth(dateOfBirth: string, onDate: Date = new Date()): number {
  const dob = new Date(`${dateOfBirth}T00:00:00.000Z`);
  const days = Math.floor((onDate.getTime() - dob.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(0, Math.floor(days / 30.4375));
}

/** The age band an age in months falls into, or null when younger than 4
 * months or older than 60 months (outside this starter item bank's coverage
 * — see docs/PEDIATRIC_CHILD_HEALTH_SPEC.md for expanding it). */
export function developmentalAgeBandFor(ageMonths: number): { min: number; max: number } | null {
  return DEVELOPMENTAL_AGE_BANDS.find((band) => ageMonths >= band.min && ageMonths <= band.max) ?? null;
}
