import { z } from "zod";
import { EMPTY_CONTEXT, READING_KEYS, type ClinicalContext } from "@tarragon/symptom-triage-engine";

/**
 * The health-record inputs the checker may use to TIGHTEN urgency (spec 12.2). They come from `symptom_check_context`, which
 * is category-scoped for someone acted for and never returns pregnancy for anyone but the person themselves. A malformed answer
 * becomes "nothing known", which can only mean fewer layers apply, never a lower result.
 */
const contextSchema = z.object({
  age_years: z.number().int().min(0).max(150).nullable(),
  sex: z.enum(["female", "male"]).nullable(),
  pregnant: z.boolean().nullable(),
  conditions: z.array(z.string()),
  medicines: z.array(z.string()),
  readings: z.record(z.string(), z.coerce.number()),
});

export function parseCheckContext(raw: unknown): ClinicalContext {
  const parsed = contextSchema.safeParse(raw);
  if (!parsed.success) return EMPTY_CONTEXT;
  const d = parsed.data;
  const readings: ClinicalContext["readings"] = {};
  for (const k of READING_KEYS) {
    const v = d.readings[k];
    if (typeof v === "number" && Number.isFinite(v)) readings[k] = v;
  }
  return { ageYears: d.age_years, sex: d.sex, pregnant: d.pregnant, conditions: d.conditions, medicines: d.medicines, readings };
}
