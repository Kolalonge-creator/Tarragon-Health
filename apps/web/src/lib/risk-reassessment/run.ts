import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { computePreventionRiskScores } from "@/lib/rules/compute-risk-scores";
import { ageFromDateOfBirth, type Json } from "@tarragon/shared";
import type { RiskAssessmentInput } from "@/lib/validation/risk-assessment";

export interface RiskReassessmentRunResult {
  queueRowsSeen: number;
  patientsConsidered: number;
  patientsReassessed: number;
  patientsSkippedNoAssessment: number;
  scoresWritten: number;
}

/**
 * Drains public.risk_reassessment_queue (see the 20260827205131 migration):
 * for every patient with at least one unprocessed queue row, reconstructs
 * their most recent questionnaire answers and calls the exact same
 * computePreventionRiskScores() function submitRiskAssessment already uses
 * — no new scoring logic, only a new trigger source for the existing
 * engine. A patient who has never completed the risk assessment has
 * nothing to recompute from; their queue rows are still marked processed
 * (there's no missing work to retry), just with zero scores written.
 *
 * Runs daily via apps/web/src/app/api/cron/risk-reassessment (Vercel Cron,
 * see vercel.json) — reassessment isn't time-critical the way the abnormal-
 * result safety net's 2-4h SLA is (that pipeline is untouched by this),
 * so a daily sweep is the right cadence, matching every other cron job in
 * this codebase.
 */
export async function runRiskReassessment(): Promise<RiskReassessmentRunResult> {
  const supabase = createServiceRoleClient();

  const { data: queueRows, error: queueError } = await supabase
    .from("risk_reassessment_queue")
    .select("id, organisation_id, patient_id")
    .is("processed_at", null);
  if (queueError) throw queueError;

  const patientIds = [...new Set((queueRows ?? []).map((r) => r.patient_id))];
  let patientsReassessed = 0;
  let patientsSkippedNoAssessment = 0;
  let scoresWritten = 0;

  for (const patientId of patientIds) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("organisation_id, sex, date_of_birth")
      .eq("id", patientId)
      .single();
    if (!profile?.organisation_id) continue;

    const { data: responseRows } = await supabase
      .from("risk_assessment_responses")
      .select("question_key, response, created_at")
      .eq("profile_id", patientId)
      .order("created_at", { ascending: false });

    if (!responseRows || responseRows.length === 0) {
      patientsSkippedNoAssessment++;
      await markPatientQueueProcessed(supabase, patientId);
      continue;
    }

    const latestByKey = new Map<string, Json>();
    for (const row of responseRows) {
      if (!latestByKey.has(row.question_key)) {
        latestByKey.set(row.question_key, row.response);
      }
    }
    const responses = Object.fromEntries(latestByKey) as unknown as RiskAssessmentInput;

    const { data: latestWeight } = await supabase
      .from("vitals_readings")
      .select("weight_kg")
      .eq("patient_id", patientId)
      .eq("vital_type", "weight")
      .order("taken_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const scoringProfile = {
      sex: profile.sex,
      ageYears: ageFromDateOfBirth(profile.date_of_birth),
      weightKg: (responses as { weight_kg?: number }).weight_kg ?? latestWeight?.weight_kg ?? null,
    };

    const scores = await computePreventionRiskScores(supabase, profile.organisation_id, responses, scoringProfile);

    if (scores.length > 0) {
      const { error: insertError } = await supabase.from("prevention_risk_scores").insert(
        scores.map((score) => ({
          organisation_id: profile.organisation_id!,
          profile_id: patientId,
          condition: score.condition,
          tier: score.tier,
          confidence: score.confidence,
          model_name: score.modelName,
          model_version: score.modelVersion,
          inputs_snapshot: score.inputsSnapshot as Json,
        }))
      );
      if (insertError) throw insertError;
      scoresWritten += scores.length;
    }

    patientsReassessed++;
    await markPatientQueueProcessed(supabase, patientId);
  }

  return {
    queueRowsSeen: queueRows?.length ?? 0,
    patientsConsidered: patientIds.length,
    patientsReassessed,
    patientsSkippedNoAssessment,
    scoresWritten,
  };
}

async function markPatientQueueProcessed(
  supabase: ReturnType<typeof createServiceRoleClient>,
  patientId: string
): Promise<void> {
  const { error } = await supabase
    .from("risk_reassessment_queue")
    .update({ processed_at: new Date().toISOString() })
    .eq("patient_id", patientId)
    .is("processed_at", null);
  if (error) throw error;
}
