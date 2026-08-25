import "server-only";
/**
 * LPE server-side service — enrolment materialisation + patient state fetch.
 * Instance rows (programme/phase/goal) are system-authored, so they're written
 * with the service-role client after the caller's identity is verified.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import {
  buildInstantiationPlan,
  type ConditionKey,
  type PhaseTemplateNode,
} from "@tarragon/lifestyle-engine";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

type CarePlanCondition = Database["public"]["Enums"]["care_plan_condition"];

const KEY_TO_CONDITION: Record<ConditionKey, CarePlanCondition> = {
  htn: "hypertension",
  diabetes: "diabetes",
  obesity: "obesity",
};

export const CONDITION_TO_KEY: Partial<Record<CarePlanCondition, ConditionKey>> = {
  hypertension: "htn",
  diabetes: "diabetes",
  obesity: "obesity",
};

export interface LifestyleGoalView {
  id: string;
  module: string;
  title: string;
  personalised: boolean;
}

export interface LifestyleEnrollmentView {
  id: string;
  condition: CarePlanCondition;
  conditionKey: ConditionKey | null;
  status: string;
  programmeName: string | null;
  currentPhaseName: string | null;
  goals: LifestyleGoalView[];
  nextReviewDue: string | null;
}

export const CONDITION_LABEL: Partial<Record<CarePlanCondition, string>> = {
  hypertension: "Blood pressure care",
  diabetes: "Diabetes care",
  obesity: "Weight & lifestyle",
};

export interface PastLifestyleGoalView {
  id: string;
  module: string;
  title: string;
  status: string;
  conditionLabel: string;
  updatedAt: string;
}

/** The patient's own resolved (non-active) goals, most recent first. RLS
 * already scopes lpe_goal_instances to the caller's own enrolments, so no
 * extra ownership filter is needed here (same trust-RLS convention as
 * getLifestyleState). */
export async function getPastLifestyleGoals(
  db: SupabaseClient<Database>,
  userId: string,
): Promise<PastLifestyleGoalView[]> {
  const { data } = await db
    .from("lpe_goal_instances")
    .select(
      "id, module, title, status, updated_at, lpe_programme_instances(lpe_enrollments(condition, patient_id))",
    )
    .neq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(50);

  return (data ?? [])
    .filter((g) => {
      const inst = g.lpe_programme_instances as {
        lpe_enrollments: { condition: CarePlanCondition; patient_id: string } | null;
      } | null;
      return inst?.lpe_enrollments?.patient_id === userId;
    })
    .map((g) => {
      const inst = g.lpe_programme_instances as {
        lpe_enrollments: { condition: CarePlanCondition } | null;
      } | null;
      const condition = inst?.lpe_enrollments?.condition;
      return {
        id: g.id,
        module: g.module,
        title: g.title,
        status: g.status,
        conditionLabel: (condition && CONDITION_LABEL[condition]) || "Lifestyle",
        updatedAt: g.updated_at,
      };
    });
}

/** Everything the patient page needs, in one call. */
export async function getLifestyleState(
  db: SupabaseClient<Database>,
  userId: string,
): Promise<LifestyleEnrollmentView[]> {
  const { data: enrollments } = await db
    .from("lpe_enrollments")
    .select("id, condition, status")
    .eq("patient_id", userId)
    .order("created_at", { ascending: true });

  if (!enrollments?.length) return [];

  const views: LifestyleEnrollmentView[] = [];
  for (const e of enrollments) {
    const { data: inst } = await db
      .from("lpe_programme_instances")
      .select(
        "id, current_phase_instance_id, programme_template_id, lpe_programme_templates(name)",
      )
      .eq("enrollment_id", e.id)
      .maybeSingle();

    let currentPhaseName: string | null = null;
    let goals: LifestyleGoalView[] = [];
    if (inst) {
      if (inst.current_phase_instance_id) {
        const { data: phase } = await db
          .from("lpe_phase_instances")
          .select("phase_template_id, lpe_phase_templates(name)")
          .eq("id", inst.current_phase_instance_id)
          .maybeSingle();
        currentPhaseName =
          (phase?.lpe_phase_templates as { name: string } | null)?.name ?? null;
      }
      const { data: goalRows } = await db
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

    const { data: review } = await db
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
      programmeName:
        (inst?.lpe_programme_templates as { name: string } | null)?.name ?? null,
      currentPhaseName,
      goals,
      nextReviewDue: review?.due_date ?? null,
    });
  }
  return views;
}

/**
 * The obesity pathway's own hardest safeguard (§6.5, §16, §18): no weight-loss
 * plan starts before an eating-disorder / mental-health screen exists. A
 * missing screen blocks enrollment outright — the caller must collect one
 * first. A *positive* screen still enrols the patient (so the programme +
 * care-team relationship exists and they land on the same supportive "paused"
 * card a later positive screen already produces via
 * `private.handle_obesity_ed_screen`) but starts the enrollment paused rather
 * than active, so no weight-loss task/nudge ever goes out before a doctor has
 * reviewed.
 */
async function getObesityEdScreenGate(
  svc: SupabaseClient<Database>,
  userId: string,
): Promise<"required" | "clear" | "needs_review"> {
  const { data } = await svc
    .from("obesity_ed_screens")
    .select("positive")
    .eq("patient_id", userId)
    .order("screened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return "required";
  return data.positive ? "needs_review" : "clear";
}

/**
 * Enrol a patient into the active programme template for a condition and
 * materialise the first phase + its goals. Idempotent per (patient, condition).
 */
export async function enrollPatient(
  userId: string,
  orgId: string,
  conditionKey: ConditionKey,
): Promise<{ ok: boolean; reason?: string }> {
  const condition = KEY_TO_CONDITION[conditionKey];
  const svc = createServiceRoleClient();

  // Already enrolled? (unique patient+condition) — treat as success.
  const { data: existing } = await svc
    .from("lpe_enrollments")
    .select("id")
    .eq("patient_id", userId)
    .eq("condition", condition)
    .maybeSingle();
  if (existing) return { ok: true };

  let initialStatus: "active" | "paused" = "active";
  let pausedReason: string | null = null;

  if (conditionKey === "obesity") {
    const gate = await getObesityEdScreenGate(svc, userId);
    if (gate === "required") return { ok: false, reason: "ed_screen_required" };
    if (gate === "needs_review") {
      initialStatus = "paused";
      pausedReason =
        "Auto-paused: positive ED/mental-health screen; care team will review before weight-loss goals begin";
    }
  }

  // Consent is captured before the programme goes live (spec §14). A live
  // enrollment without an unrevoked consent is rejected by a DB trigger.
  const { data: consent, error: consentErr } = await svc
    .from("lpe_consents")
    .insert({
      organisation_id: orgId,
      patient_id: userId,
      scope: "lifestyle_programme",
      channel: "web",
    })
    .select("id")
    .single();
  if (consentErr || !consent) return { ok: false, reason: "consent_failed" };

  const { data: template } = await svc
    .from("lpe_programme_templates")
    .select("id")
    .eq("condition", condition)
    .eq("active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!template) return { ok: false, reason: "no_template" };

  // Load the template graph (phases + first-phase goals).
  const { data: phaseRows } = await svc
    .from("lpe_phase_templates")
    .select("id, key, order_index, kind, duration_days_min, duration_days_max, auto_advance")
    .eq("programme_template_id", template.id)
    .order("order_index", { ascending: true });
  if (!phaseRows?.length) return { ok: false, reason: "no_phases" };

  const firstPhaseId = phaseRows[0]!.id;
  const { data: goalRows } = await svc
    .from("lpe_goal_templates")
    .select("id, module, title, metric_key, target")
    .eq("phase_template_id", firstPhaseId);

  const phases: PhaseTemplateNode[] = phaseRows.map((p) => ({
    id: p.id,
    key: p.key,
    orderIndex: p.order_index,
    kind: p.kind,
    durationDaysMin: p.duration_days_min,
    durationDaysMax: p.duration_days_max,
    autoAdvance: p.auto_advance,
    goals:
      p.id === firstPhaseId
        ? (goalRows ?? []).map((g) => ({
            id: g.id,
            module: g.module,
            title: g.title,
            metricKey: g.metric_key,
            target: g.target,
          }))
        : [],
  }));

  const startedAt = new Date().toISOString();
  const plan = buildInstantiationPlan({ phases, startedAt });

  // Create enrollment (active, unless the ED-screen gate above says otherwise).
  const { data: enrollment, error: enrErr } = await svc
    .from("lpe_enrollments")
    .insert({
      organisation_id: orgId,
      patient_id: userId,
      condition,
      status: initialStatus,
      paused_reason: pausedReason,
      started_at: startedAt,
      consent_id: consent.id,
    })
    .select("id")
    .single();
  if (enrErr || !enrollment) return { ok: false, reason: "enrollment_failed" };

  // Programme instance.
  const { data: programmeInstance, error: piErr } = await svc
    .from("lpe_programme_instances")
    .insert({
      organisation_id: orgId,
      enrollment_id: enrollment.id,
      programme_template_id: template.id,
    })
    .select("id")
    .single();
  if (piErr || !programmeInstance) return { ok: false, reason: "instance_failed" };

  // Phase instances.
  const phaseInserts = plan.phases.map((p) => ({
    organisation_id: orgId,
    programme_instance_id: programmeInstance.id,
    phase_template_id: p.phaseTemplateId,
    status: p.status,
    started_at: p.startedAt,
    target_end_at: p.targetEndAt,
  }));
  const { data: phaseInstances, error: phErr } = await svc
    .from("lpe_phase_instances")
    .insert(phaseInserts)
    .select("id, phase_template_id");
  if (phErr) return { ok: false, reason: "phases_failed" };

  // Set current phase + first-phase goals.
  const currentPhase = phaseInstances?.find((p) => p.phase_template_id === firstPhaseId);
  if (currentPhase) {
    await svc
      .from("lpe_programme_instances")
      .update({ current_phase_instance_id: currentPhase.id })
      .eq("id", programmeInstance.id);
  }

  if (plan.firstPhaseGoals.length) {
    await svc.from("lpe_goal_instances").insert(
      plan.firstPhaseGoals.map((g) => ({
        organisation_id: orgId,
        programme_instance_id: programmeInstance.id,
        goal_template_id: g.goalTemplateId,
        module: g.module,
        title: g.title,
        metric_key: g.metricKey,
      })),
    );
  }

  return { ok: true };
}
