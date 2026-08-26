import { createClient } from "@/lib/supabase/server";
import { DiabetesSelfMonitoring } from "./diabetes-self-monitoring";
import { DiabetesGuidance } from "./diabetes-guidance";
import { DiabetesTypeSelector } from "./diabetes-type-selector";

/**
 * Wires up the diabetes daily-logging surface (insulin doses, foot
 * self-check, sick-day log — diabetes-self-monitoring.tsx), the diabetes
 * type self-report/confirmation, and the safety guide (hypo 15/15, sick-day
 * rules, insulin storage — diabetes-guidance.tsx). All three had full
 * schema + validation + server-action support since 2026-07-20 but were
 * never imported anywhere — the same "built, wired to nothing" pattern
 * glucose-insights.tsx had until 2026-08-10 (see that component's own
 * history). Gated on an active diabetes care plan, same condition
 * pregnancy-status.tsx already uses for its own diabetes-specific guard.
 */
export async function DiabetesDailyLog({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const [{ data: plan }, { data: profile }] = await Promise.all([
    supabase
      .from("care_plans")
      .select("id")
      .eq("patient_id", patientId)
      .eq("condition", "diabetes")
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("patient_diabetes_profile")
      .select("patient_reported_type, confirmed_type")
      .eq("patient_id", patientId)
      .maybeSingle(),
  ]);

  if (!plan) return null;

  const effectiveType = profile?.confirmed_type ?? profile?.patient_reported_type ?? null;

  return (
    <>
      <DiabetesSelfMonitoring />
      <DiabetesTypeSelector
        currentReported={profile?.patient_reported_type ?? null}
        confirmed={profile?.confirmed_type ?? null}
      />
      <DiabetesGuidance diabetesType={effectiveType} />
    </>
  );
}
