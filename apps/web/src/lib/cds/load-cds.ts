import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { loadMedicationSafety } from "@/lib/clinical/patient-clinical-context";
import { computeCdsRecommendations, type CkdRiskCategory, type HbpmContext } from "./engine";
import { prioritiseCdsRecommendations, type CdsDecisionRecord, type PrioritisedCds } from "./prioritise";

type Client = SupabaseClient<Database>;

export interface CdsView extends PrioritisedCds {
  medicationCount: number;
}

/**
 * Assembles the point-of-care CDS view (§38.4: record -> clinical context ->
 * relevant CDS -> clinician reviews -> decision) for one patient, then applies
 * the fatigue cap and decision-history suppression.
 *
 * Every read goes through the CALLER'S OWN Supabase client, so RLS is the real
 * authorisation gate exactly as every other loader in lib/clinical/ and
 * lib/cv-risk/ does — this module adds no privilege of its own.
 */
export async function loadCdsView(supabase: Client, patientId: string): Promise<CdsView> {
  const [medicationSafety, hbpmResult, secondaryFlagsResult, labMonitoringResult, reviewsResult, decisionsResult] =
    await Promise.all([
      loadMedicationSafety(supabase, patientId),
      supabase.rpc("hbpm_summary", { p_patient: patientId }),
      supabase.rpc("bp_secondary_flags", { p_patient: patientId }),
      supabase
        .from("medication_lab_monitoring")
        .select("id, medication_id, drug_class, monitoring_label, due_date")
        .eq("patient_id", patientId)
        .eq("status", "pending"),
      supabase
        .from("medication_reviews")
        .select("id, due_date, care_plan:care_plans!medication_reviews_care_plan_id_fkey(condition)")
        .eq("patient_id", patientId)
        .eq("status", "pending"),
      supabase
        .from("cds_recommendation_decisions")
        .select("recommendation_key, recommendation_fingerprint, decision, suppress_until, decided_at")
        .eq("patient_id", patientId),
    ]);

  // hbpm_summary/bp_secondary_flags are best-effort context, not the reason
  // this view exists — a patient with no HBPM readings yet (or an RPC error)
  // still gets every other recommendation family rather than an empty panel.
  const hbpm = (hbpmResult.data ?? null) as unknown as HbpmContext | null;
  const secondaryFlags = ((secondaryFlagsResult.data as unknown as { flags?: string[] } | null)?.flags ?? []);

  const ckdRiskCategory: CkdRiskCategory | null =
    medicationSafety.ckdRisk?.riskLevel === "low" ||
    medicationSafety.ckdRisk?.riskLevel === "moderate" ||
    medicationSafety.ckdRisk?.riskLevel === "high" ||
    medicationSafety.ckdRisk?.riskLevel === "very_high"
      ? medicationSafety.ckdRisk.riskLevel
      : null; // 'unknown' or no reading on file — nothing to alert on

  const pendingLabMonitoring = (labMonitoringResult.data ?? []).map((row) => ({
    id: row.id,
    medicationId: row.medication_id,
    drugClass: row.drug_class,
    monitoringLabel: row.monitoring_label,
    dueDate: row.due_date,
  }));

  const pendingConditionReviews = (reviewsResult.data ?? [])
    .filter((row): row is typeof row & { care_plan: { condition: string } } => row.care_plan !== null)
    .map((row) => ({
      id: row.id,
      condition: row.care_plan.condition,
      dueDate: row.due_date,
    }));

  const recommendations = computeCdsRecommendations({
    medicationSafety: medicationSafety.report,
    hbpm,
    bpSecondaryFlags: secondaryFlags,
    pendingLabMonitoring,
    pendingConditionReviews,
    ckdRiskCategory,
    now: new Date(),
  });

  const decisions: CdsDecisionRecord[] = (decisionsResult.data ?? []).map((row) => ({
    recommendationKey: row.recommendation_key,
    fingerprint: row.recommendation_fingerprint,
    decision: row.decision,
    suppressUntil: row.suppress_until,
    decidedAt: row.decided_at,
  }));

  const prioritised = prioritiseCdsRecommendations(recommendations, decisions);

  return { ...prioritised, medicationCount: medicationSafety.medicationCount };
}
