import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Enums } from "@tarragon/shared";

export type LpeConditionKey = "htn" | "diabetes" | "obesity";
export type LpeGoalModule = Enums<"lpe_module">;
export type LpeGoalStatus = Enums<"lpe_goal_status">;

const CONDITION_TO_KEY: Record<string, LpeConditionKey> = {
  hypertension: "htn",
  diabetes: "diabetes",
  obesity: "obesity",
};

export interface LifestyleGoal {
  id: string;
  module: string;
  title: string;
  personalised: boolean;
}

export interface LifestyleEnrollment {
  id: string;
  condition: string;
  conditionKey: LpeConditionKey | null;
  status: string;
  programmeName: string | null;
  currentPhaseName: string | null;
  goals: LifestyleGoal[];
  nextReviewDue: string | null;
}

/**
 * Mirrors apps/web/src/lib/lifestyle/service.ts's getLifestyleState exactly
 * — plain RLS-scoped reads over lpe_enrollments/lpe_programme_instances/
 * lpe_phase_instances/lpe_goal_instances/lpe_reviews, safe to run directly
 * from the client (unlike enrollPatient/ingestMeasurement, nothing here
 * writes or evaluates a safety rule).
 */
export async function loadLifestyleState(patientId: string): Promise<QueryResult<LifestyleEnrollment[]>> {
  const { data: enrollments, error } = await supabase
    .from("lpe_enrollments")
    .select("id, condition, status")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: error.message };
  if (!enrollments?.length) return { ok: true, data: [] };

  const views: LifestyleEnrollment[] = [];
  for (const e of enrollments) {
    const { data: inst } = await supabase
      .from("lpe_programme_instances")
      .select("id, current_phase_instance_id, programme_template_id, lpe_programme_templates(name)")
      .eq("enrollment_id", e.id)
      .maybeSingle();

    let currentPhaseName: string | null = null;
    let goals: LifestyleGoal[] = [];
    if (inst) {
      if (inst.current_phase_instance_id) {
        const { data: phase } = await supabase
          .from("lpe_phase_instances")
          .select("phase_template_id, lpe_phase_templates(name)")
          .eq("id", inst.current_phase_instance_id)
          .maybeSingle();
        currentPhaseName = (phase?.lpe_phase_templates as { name: string } | null)?.name ?? null;
      }
      const { data: goalRows } = await supabase
        .from("lpe_goal_instances")
        .select("id, module, title, status, personalised")
        .eq("programme_instance_id", inst.id)
        .eq("status", "active");
      goals = (goalRows ?? []).map((g) => ({
        id: g.id,
        module: g.module,
        title: g.title,
        personalised: g.personalised,
      }));
    }

    const { data: review } = await supabase
      .from("lpe_reviews")
      .select("due_date")
      .eq("enrollment_id", e.id)
      .eq("status", "pending")
      .maybeSingle();

    views.push({
      id: e.id,
      condition: e.condition,
      conditionKey: CONDITION_TO_KEY[e.condition] ?? null,
      status: e.status,
      programmeName: (inst?.lpe_programme_templates as { name: string } | null)?.name ?? null,
      currentPhaseName,
      goals,
      nextReviewDue: review?.due_date ?? null,
    });
  }
  return { ok: true, data: views };
}

const CONDITION_LABEL: Record<string, string> = {
  hypertension: "Blood pressure care",
  diabetes: "Diabetes care",
  obesity: "Weight & lifestyle",
};

export interface PastLifestyleGoal {
  id: string;
  module: string;
  title: string;
  status: string;
  conditionLabel: string;
  updatedAt: string;
}

/** Mirrors apps/web/src/lib/lifestyle/service.ts's getPastLifestyleGoals — a
 * patient's own resolved (non-active) goals, most recent first. RLS already
 * scopes lpe_goal_instances to the caller's own enrolments, so the extra
 * patient_id filter below is belt-and-braces, not a substitute for RLS. */
export async function loadPastLifestyleGoals(patientId: string): Promise<QueryResult<PastLifestyleGoal[]>> {
  const { data, error } = await supabase
    .from("lpe_goal_instances")
    .select("id, module, title, status, updated_at, lpe_programme_instances(lpe_enrollments(condition, patient_id))")
    .neq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) return { ok: false, error: error.message };

  const filtered = (data ?? []).filter((g) => {
    const inst = g.lpe_programme_instances as {
      lpe_enrollments: { condition: string; patient_id: string } | null;
    } | null;
    return inst?.lpe_enrollments?.patient_id === patientId;
  });

  return {
    ok: true,
    data: filtered.map((g) => {
      const inst = g.lpe_programme_instances as { lpe_enrollments: { condition: string } | null } | null;
      const condition = inst?.lpe_enrollments?.condition;
      return {
        id: g.id,
        module: g.module,
        title: g.title,
        status: g.status,
        conditionLabel: (condition && CONDITION_LABEL[condition]) || "Lifestyle",
        updatedAt: g.updated_at,
      };
    }),
  };
}

export interface ObesityAssessment {
  bmi: number | null;
  bmi_category: string | null;
  waist_risk: string | null;
  clinical_status: string | null;
  assessed_at: string;
}

/** Mirrors apps/web/.../obesity-summary.tsx's read — doctor-recorded, null-gated. */
export async function loadObesityAssessment(patientId: string): Promise<ObesityAssessment | null> {
  const { data } = await supabase
    .from("obesity_assessments")
    .select("bmi, bmi_category, waist_risk, clinical_status, assessed_at")
    .eq("patient_id", patientId)
    .order("assessed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export interface BariatricReferral {
  status: string;
  referred_at: string;
}

/** Mirrors apps/web/.../weight-management/bariatric-referral-status.tsx. */
export async function loadBariatricReferral(patientId: string): Promise<BariatricReferral | null> {
  const { data } = await supabase
    .from("bariatric_referrals")
    .select("status, referred_at")
    .eq("patient_id", patientId)
    .order("referred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/** Mirrors apps/web/.../lifestyle/actions.ts's createGoalAction — a plain
 * RLS-scoped RPC, safe to call directly. */
export async function createPersonalisedGoal(input: {
  enrollmentId: string;
  module: LpeGoalModule;
  title: string;
  targetValue?: number;
  targetUnit?: string;
  targetDate?: string;
}): Promise<QueryResult<null>> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Please describe your goal" };
  const { error } = await supabase.rpc("create_personalised_lifestyle_goal", {
    p_enrollment_id: input.enrollmentId,
    p_module: input.module,
    p_title: title,
    p_target_value: input.targetValue,
    p_target_unit: input.targetUnit,
    p_target_date: input.targetDate,
  });
  if (error) return { ok: false, error: error.message || "Could not save your goal" };
  return { ok: true, data: null };
}

/** Mirrors apps/web/.../lifestyle/actions.ts's resolveGoalAction. The
 * smoking/risk_assessment_responses side effect there is a UI-adjacent
 * convenience write, not a safety check — porting it here is a reasonable
 * follow-up, not a safety gap if it lags this pass. */
export async function resolvePersonalisedGoal(
  goalId: string,
  status: Extract<LpeGoalStatus, "achieved" | "abandoned">
): Promise<QueryResult<null>> {
  const { error } = await supabase.rpc("resolve_personalised_lifestyle_goal", {
    p_goal_id: goalId,
    p_status: status,
  });
  if (error) return { ok: false, error: error.message || "Could not update this goal" };
  return { ok: true, data: null };
}
