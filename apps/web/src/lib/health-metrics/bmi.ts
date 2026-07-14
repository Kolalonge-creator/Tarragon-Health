import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * Shared between Health Score's assess-health-score.ts and the Health
 * Passport — both need "the patient's current BMI" from the same two
 * sources (latest logged weight, most recent height_cm from a risk
 * assessment submission), so the fetch lives in one place rather than
 * being duplicated.
 */
export async function fetchLatestBmi(
  supabase: SupabaseClient<Database>,
  patientId: string
): Promise<number | null> {
  const [{ data: weightRow }, { data: heightRow }] = await Promise.all([
    supabase
      .from("vitals_readings")
      .select("weight_kg")
      .eq("patient_id", patientId)
      .eq("vital_type", "weight")
      .order("taken_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("risk_assessment_responses")
      .select("response")
      .eq("profile_id", patientId)
      .eq("question_key", "height_cm")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const weightKg = weightRow?.weight_kg ?? null;
  const heightCm = typeof heightRow?.response === "number" ? heightRow.response : null;
  if (!weightKg || !heightCm) return null;

  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
}
