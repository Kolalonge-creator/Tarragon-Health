import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export type WellbeingCohortMetric = {
  respondedCount: number;
  totalCount: number;
  /** severity_band -> percent of respondents, rounded, never a raw score. */
  phq9: Record<string, number>;
  gad7: Record<string, number>;
} | null;

/** Parses the aggregate function's answer. Anything unexpected, and anything suppressed, is null: never a partial figure. */
export function parseWellbeingCohort(raw: unknown): WellbeingCohortMetric {
  const r = raw as { suppressed?: unknown; responded?: unknown; total?: unknown; phq9?: unknown; gad7?: unknown } | null;
  if (!r || typeof r !== "object" || r.suppressed !== false) return null;
  if (typeof r.responded !== "number" || typeof r.total !== "number") return null;
  const dist = (v: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    if (v && typeof v === "object") {
      for (const [band, pct] of Object.entries(v as Record<string, unknown>)) if (typeof pct === "number") out[band] = pct;
    }
    return out;
  };
  return { respondedCount: r.responded, totalCount: r.total, phq9: dist(r.phq9), gad7: dist(r.gad7) };
}

/**
 * Module 46 §46.14 workplace wellbeing: an aggregate-only, cohort-level distribution of the most recent PHQ-9/GAD-7 severity band
 * across the organisation's patients. Since S56 the aggregate is computed by `public.corporate_wellbeing_cohort` (service role only),
 * which applies the organisation's own minimum cohort size to the number of respondents (not only to the cohort), excludes test
 * accounts (INV-13), and returns percentages only: no score, no id. Below the minimum the answer is "suppressed" and this returns
 * null. The caller is the verified institution doorway (requireInstitutionAggregateAccess), whose client is the service role.
 */
export async function loadWellbeingCohortMetric(
  supabase: SupabaseClient<Database>,
  organisationId: string
): Promise<WellbeingCohortMetric> {
  const { data, error } = await supabase.rpc("corporate_wellbeing_cohort", { p_org: organisationId });
  if (error) return null;
  return parseWellbeingCohort(data);
}
