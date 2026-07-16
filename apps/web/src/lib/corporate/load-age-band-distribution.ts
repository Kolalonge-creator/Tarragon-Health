import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { ageFromDateOfBirth } from "@tarragon/shared";

export const AGE_BANDS = ["<30", "30-45", "45-60", "60+"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export type AgeBandDistribution = Record<AgeBand, number> | null;

function bandFor(age: number): AgeBand {
  if (age < 30) return "<30";
  if (age < 45) return "30-45";
  if (age < 60) return "45-60";
  return "60+";
}

/**
 * Age-band segmentation for the corporate/HMO dashboards — computed
 * client/server-side from profiles.date_of_birth (already fetched for the
 * ML cohort call in load-cohort-analytics.ts) rather than round-tripped
 * through the ML service, since bucketing ages already in hand is a pure
 * derivation, not a modeling task.
 */
export async function loadAgeBandDistribution(
  supabase: SupabaseClient<Database>,
  organisationId: string
): Promise<AgeBandDistribution> {
  const { data: patients } = await supabase
    .from("profiles")
    .select("date_of_birth")
    .eq("organisation_id", organisationId)
    .eq("role", "patient");
  if (!patients || patients.length === 0) return null;

  const distribution: Record<AgeBand, number> = { "<30": 0, "30-45": 0, "45-60": 0, "60+": 0 };
  let counted = 0;
  for (const p of patients) {
    const age = ageFromDateOfBirth(p.date_of_birth);
    if (age === null) continue;
    distribution[bandFor(age)] += 1;
    counted += 1;
  }
  return counted > 0 ? distribution : null;
}
