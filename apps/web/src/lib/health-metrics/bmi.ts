import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { computeBmi } from "@/lib/obesity/classify";
import { fetchHeightStatus } from "./height";

/**
 * Shared between Health Score's assess-health-score.ts and the Health
 * Passport — both need "the patient's current BMI" from the same two
 * sources (latest logged weight, canonical height — see height.ts), so the
 * fetch lives in one place rather than being duplicated.
 */
export async function fetchLatestBmi(
  supabase: SupabaseClient<Database>,
  patientId: string
): Promise<number | null> {
  const [{ data: weightRow }, heightStatus] = await Promise.all([
    supabase
      .from("vitals_readings")
      .select("weight_kg")
      .eq("patient_id", patientId)
      .eq("vital_type", "weight")
      .order("taken_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    fetchHeightStatus(supabase, patientId),
  ]);

  const weightKg = weightRow?.weight_kg ?? null;
  const heightCm = heightStatus.heightCm;
  if (!weightKg || !heightCm) return null;

  return computeBmi(weightKg, heightCm);
}
