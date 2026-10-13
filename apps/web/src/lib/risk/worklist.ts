import { z } from "zod";

/**
 * The clinician risk worklist and the fairness report as the database returns them (S38c, Module 22.3). Parsed, never trusted.
 * The score only orders outreach for clinicians who are already tied to the patient. It is not a clinical grade and never a reason
 * to withhold care, and a low score never means no contact; the screen says so.
 */
export const LEVELS = ["high", "medium", "low"] as const;
export type RiskLevel = (typeof LEVELS)[number];

const reason = z.object({ key: z.string(), family: z.enum(["deterioration", "dropout"]), points: z.number() });

const row = z.object({
  patient_id: z.string().uuid(),
  patient_number: z.string().nullable(),
  level: z.enum(LEVELS),
  computed_level: z.enum(LEVELS),
  overridden: z.boolean(),
  deterioration_risk: z.number().int(),
  dropout_risk: z.number().int(),
  reasons: z.array(reason),
  computed_on: z.string(),
  model_version: z.number().int(),
});
export type WorklistRow = z.infer<typeof row>;

const worklist = z.object({ rows: z.array(row), note: z.string() });
export function parseWorklist(data: unknown): { rows: WorklistRow[]; note: string } | null {
  const r = worklist.safeParse(data);
  return r.success ? r.data : null;
}

/** Staff-facing plain English for each reason key. Staff pages are English only (OQ-102 precedent). */
export const REASON_LABEL: Record<string, string> = {
  bp_well_above_target: "7-day average well above their target",
  bp_above_target: "7-day average above their target",
  bp_rising: "Average has risen since the week before",
  recent_red_event: "A red event in the last 30 days",
  recent_amber_event: "An amber event in the last 30 days",
  last_snapshot_uncontrolled: "Last outcome snapshot was not under target",
  low_adherence: "Medicines taken less often than planned",
  no_readings_ever: "Joined but has not logged a reading",
  silent_long: "No reading for 10 days or more",
  silent_some: "No reading for 5 days or more",
  fewer_readings: "Logging far less than in the two weeks before",
};

export function reasonLabel(key: string): string {
  return REASON_LABEL[key] ?? key;
}

const cell = z.union([
  z.object({ key: z.string(), suppressed: z.literal(true) }),
  z.object({ key: z.string(), n: z.number().int(), high: z.number().int(), medium: z.number().int(), low: z.number().int(), high_pct: z.number() }),
]);
export type FairnessCell = z.infer<typeof cell>;
const fairness = z.object({
  total_scored: z.number().int().nullable(),
  minimum_cell: z.number().int(),
  by: z.object({ sex: z.array(cell), age_band: z.array(cell), state: z.array(cell) }),
  purpose: z.string(),
});
export type Fairness = z.infer<typeof fairness>;
export function parseFairness(data: unknown): Fairness | null {
  const r = fairness.safeParse(data);
  return r.success ? r.data : null;
}
export const isShownCell = (c: FairnessCell): c is Extract<FairnessCell, { n: number }> => !("suppressed" in c);
