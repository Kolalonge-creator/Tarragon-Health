import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Tables } from "@tarragon/shared";

export type WeightManagementEnrolment = Tables<"weight_management_enrolments">;
export type WeightManagementCheckin = Tables<"weight_management_checkins">;
export type WeightManagementDoseStep = Tables<"weight_management_dose_steps">;

export interface SupervisedWeightManagementState {
  enrolment: WeightManagementEnrolment | null;
  checkins: WeightManagementCheckin[];
  doseSteps: WeightManagementDoseStep[];
}

/**
 * Supervised Weight Management, native — mirrors
 * apps/web/src/lib/queries/weight-management.ts's three read hooks in one
 * round trip. Nothing here decides eligibility or agrees a dose: only
 * clinical staff can move an enrolment to 'active' (the RLS update policy
 * admits org staff alone), enforced server-side, not by this file.
 */
export async function loadSupervisedWeightManagementState(
  patientId: string
): Promise<QueryResult<SupervisedWeightManagementState>> {
  const { data: enrolment, error: enrolmentError } = await supabase
    .from("weight_management_enrolments")
    .select("*")
    .eq("patient_id", patientId)
    .in("status", ["pending_eligibility", "active", "paused"])
    .maybeSingle();
  if (enrolmentError) return { ok: false, error: enrolmentError.message };
  if (!enrolment) return { ok: true, data: { enrolment: null, checkins: [], doseSteps: [] } };

  const [checkinsResult, doseStepsResult] = await Promise.all([
    supabase
      .from("weight_management_checkins")
      .select("*")
      .eq("enrolment_id", enrolment.id)
      .order("checked_in_at", { ascending: false })
      .limit(12),
    supabase
      .from("weight_management_dose_steps")
      .select("*")
      .eq("enrolment_id", enrolment.id)
      .order("step_number", { ascending: true }),
  ]);
  if (checkinsResult.error) return { ok: false, error: checkinsResult.error.message };
  if (doseStepsResult.error) return { ok: false, error: doseStepsResult.error.message };

  return {
    ok: true,
    data: {
      enrolment,
      checkins: (checkinsResult.data ?? []) as WeightManagementCheckin[],
      doseSteps: (doseStepsResult.data ?? []) as WeightManagementDoseStep[],
    },
  };
}

export interface SubmitWeightCheckinInput {
  organisationId: string;
  enrolmentId: string;
  patientId: string;
  weightKg?: number | null;
  nausea: number;
  vomiting: number;
  diarrhoea: number;
  constipation: number;
  abdominalPain: number;
  poorOralIntake: boolean;
  redFlagReported: boolean;
  patientNote?: string;
}

/**
 * The fortnightly tolerability check-in — mirrors useSubmitWeightCheckin.
 * red_flag_reported is asked as its own explicit question rather than
 * inferred from the severity scores, because inferring it would mean
 * deciding on the patient's behalf what counts as severe.
 */
export async function submitSupervisedWeightCheckin(input: SubmitWeightCheckinInput): Promise<QueryResult<null>> {
  const { error } = await supabase.from("weight_management_checkins").insert({
    organisation_id: input.organisationId,
    enrolment_id: input.enrolmentId,
    patient_id: input.patientId,
    weight_kg: input.weightKg ?? null,
    nausea: input.nausea,
    vomiting: input.vomiting,
    diarrhoea: input.diarrhoea,
    constipation: input.constipation,
    abdominal_pain: input.abdominalPain,
    poor_oral_intake: input.poorOralIntake,
    red_flag_reported: input.redFlagReported,
    patient_note: input.patientNote ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}
