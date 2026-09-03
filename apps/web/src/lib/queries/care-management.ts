import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type CaseRow = Tables<"care_management_cases">;
export type CaseWithDetails = CaseRow & {
  patient: { full_name: string | null } | null;
  case_manager: { full_name: string } | null;
};
export type CaseGoal = Tables<"care_plan_goals">;
export type CasePlanItem = Tables<"care_plan_interventions">;
export type CaseBarrier = Tables<"care_management_barriers">;
export type CaseEvent = Tables<"care_management_case_events">;

const CASE_SELECT =
  "*, patient:profiles!care_management_cases_patient_id_fkey(full_name), case_manager:clinical_staff!care_management_cases_case_manager_id_fkey(full_name)";

function casesKey() {
  return ["care-management", "cases"];
}
function caseKey(caseId: string) {
  return ["care-management", "case", caseId];
}
function goalsKey(caseId: string) {
  return ["care-management", "goals", caseId];
}
function planItemsKey(caseId: string) {
  return ["care-management", "plan-items", caseId];
}
function barriersKey(caseId: string) {
  return ["care-management", "barriers", caseId];
}
function eventsKey(caseId: string) {
  return ["care-management", "events", caseId];
}

/** Every active case, most recently opened first — the case-management worklist. */
export function useActiveCases() {
  return useQuery({
    queryKey: casesKey(),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_management_cases")
        .select(CASE_SELECT)
        .eq("status", "active")
        .order("opened_at", { ascending: false });
      if (error) throw error;
      return data as CaseWithDetails[];
    },
  });
}

/**
 * 74.7 candidates: high-risk patients (public.high_risk_patient_ids(), the
 * existing "High-risk" roster filter) who are not already in an active
 * case. Surfaced as a suggestion list, never auto-opened — opening a case
 * is always a deliberate staff action (useOpenCase), matching how every
 * other entry reason here works.
 */
export function useCaseCandidates() {
  return useQuery({
    queryKey: ["care-management", "candidates"],
    queryFn: async () => {
      const supabase = createClient();
      const [{ data: highRisk, error: riskError }, { data: activeCases, error: caseError }] =
        await Promise.all([
          supabase.rpc("high_risk_patient_ids"),
          supabase.from("care_management_cases").select("patient_id").eq("status", "active"),
        ]);
      if (riskError) throw riskError;
      if (caseError) throw caseError;
      const alreadyInCase = new Set((activeCases ?? []).map((c) => c.patient_id));
      const candidateIds = (highRisk ?? [])
        .map((r) => r.patient_id)
        .filter((id) => !alreadyInCase.has(id));
      if (candidateIds.length === 0) return [];
      const { data: patients, error: patientError } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", candidateIds);
      if (patientError) throw patientError;
      return patients ?? [];
    },
  });
}

export function useCase(caseId: string) {
  return useQuery({
    queryKey: caseKey(caseId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_management_cases")
        .select(CASE_SELECT)
        .eq("id", caseId)
        .single();
      if (error) throw error;
      return data as CaseWithDetails;
    },
    enabled: !!caseId,
  });
}

/**
 * 74.7 manual open — every entry reason except hospital_discharge (which
 * private.open_or_reuse_care_management_case handles from the discharge
 * trigger) goes through this plain insert. RLS (is_org_staff) is the only
 * write gate; opening a case carries no clinical-tier requirement (a Care
 * Coordinator may open one for care_coordinator_escalation).
 */
export function useOpenCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      organisationId,
      patientId,
      entryReason,
      entryDetail,
      referringAlertId,
      riskScoreId,
    }: {
      organisationId: string;
      patientId: string;
      entryReason: CaseRow["entry_reason"];
      entryDetail: string | null;
      referringAlertId?: string | null;
      riskScoreId?: string | null;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("care_management_cases")
        .insert({
          organisation_id: organisationId,
          patient_id: patientId,
          entry_reason: entryReason,
          entry_detail: entryDetail,
          referring_alert_id: referringAlertId ?? null,
          risk_score_id: riskScoreId ?? null,
          opened_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      const { error: eventError } = await supabase.from("care_management_case_events").insert({
        case_id: data.id,
        organisation_id: organisationId,
        patient_id: patientId,
        event_type: "opened",
        reason: entryDetail,
        actor_id: user?.id ?? null,
      });
      if (eventError) throw eventError;
      return data.id as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: casesKey() });
      queryClient.invalidateQueries({ queryKey: ["care-management", "candidates"] });
    },
  });
}

export function useAssignCaseManager() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ caseId, caseManagerId }: { caseId: string; caseManagerId: string | null }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("care_management_cases")
        .update({ case_manager_id: caseManagerId })
        .eq("id", caseId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: caseKey(variables.caseId) });
      queryClient.invalidateQueries({ queryKey: casesKey() });
    },
  });
}

/** 74.14: server-enforced gate (goals achieved / actions resolved / clinical-tier closer). */
export function useCloseCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ caseId, closureSummary }: { caseId: string; closureSummary: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("close_care_management_case", {
        p_case_id: caseId,
        p_closure_summary: closureSummary,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: caseKey(variables.caseId) });
      queryClient.invalidateQueries({ queryKey: casesKey() });
      queryClient.invalidateQueries({ queryKey: eventsKey(variables.caseId) });
    },
  });
}

/** 74.15: no mechanical gate specified for reopening, only valid-reason context — plain write. */
export function useReopenCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ caseId, reason }: { caseId: string; reason: string }) => {
      const supabase = createClient();
      const { data: existing, error: fetchError } = await supabase
        .from("care_management_cases")
        .select("organisation_id, patient_id")
        .eq("id", caseId)
        .single();
      if (fetchError) throw fetchError;
      const { error } = await supabase
        .from("care_management_cases")
        .update({ status: "active" })
        .eq("id", caseId);
      if (error) throw error;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error: eventError } = await supabase.from("care_management_case_events").insert({
        case_id: caseId,
        organisation_id: existing.organisation_id,
        patient_id: existing.patient_id,
        event_type: "reopened",
        reason,
        actor_id: user?.id ?? null,
      });
      if (eventError) throw eventError;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: caseKey(variables.caseId) });
      queryClient.invalidateQueries({ queryKey: casesKey() });
      queryClient.invalidateQueries({ queryKey: eventsKey(variables.caseId) });
    },
  });
}

/**
 * 74.13 escalation — raises a clinician_alerts row (case_id-linked), routed
 * through the existing classify/assign/ack-timeout-ladder machinery via the
 * case_escalation alert_type_code, not a bespoke ladder. Any org staff
 * (including a Care Coordinator) may escalate — same "raise, never claim"
 * posture as the existing escalations page.
 */
const ESCALATION_LEVEL: Record<string, "clinician_review" | "urgent_escalation" | "emergency"> = {
  clinician: "clinician_review",
  senior_doctor: "urgent_escalation",
  specialist: "urgent_escalation",
  emergency: "emergency",
};

export function useEscalateCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      caseId,
      organisationId,
      patientId,
      targetLevel,
      reason,
    }: {
      caseId: string;
      organisationId: string;
      patientId: string;
      targetLevel: keyof typeof ESCALATION_LEVEL;
      reason: string;
    }) => {
      const supabase = createClient();
      const level = ESCALATION_LEVEL[targetLevel];
      const title =
        targetLevel === "specialist"
          ? "Case escalated — specialist referral needed"
          : `Case escalated to ${targetLevel.replace("_", " ")}`;
      const { data: alert, error } = await supabase
        .from("clinician_alerts")
        .insert({
          organisation_id: organisationId,
          patient_id: patientId,
          level,
          override_level: level,
          title,
          detail: reason,
          type_code: "case_escalation",
          category: "care_management",
          case_id: caseId,
        })
        .select("id")
        .single();
      if (error) throw error;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error: eventError } = await supabase.from("care_management_case_events").insert({
        case_id: caseId,
        organisation_id: organisationId,
        patient_id: patientId,
        event_type: "escalated",
        reason,
        target_level: targetLevel,
        clinician_alert_id: alert.id,
        actor_id: user?.id ?? null,
      });
      if (eventError) throw eventError;
      return alert.id as string;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: eventsKey(variables.caseId) });
    },
  });
}

export function useCaseGoals(caseId: string) {
  return useQuery({
    queryKey: goalsKey(caseId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_plan_goals")
        .select("*")
        .eq("case_id", caseId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as CaseGoal[];
    },
    enabled: !!caseId,
  });
}

export function useAddCaseGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      caseId,
      organisationId,
      patientId,
      description,
    }: {
      caseId: string;
      organisationId: string;
      patientId: string;
      description: string;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase.from("care_plan_goals").insert({
        case_id: caseId,
        organisation_id: organisationId,
        patient_id: patientId,
        description,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: goalsKey(variables.caseId) });
    },
  });
}

export function useUpdateCaseGoalStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      goalId,
      status,
    }: {
      goalId: string;
      caseId: string;
      status: "achieved" | "abandoned";
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("care_plan_goals")
        .update({ status, resolved_at: new Date().toISOString() })
        .eq("id", goalId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: goalsKey(variables.caseId) });
    },
  });
}

/** 74.6: Problem -> Goal -> Intervention -> Owner -> Deadline -> Outcome, one row per case plan item. */
export function useCasePlanItems(caseId: string) {
  return useQuery({
    queryKey: planItemsKey(caseId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_plan_interventions")
        .select("*")
        .eq("case_id", caseId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as CasePlanItem[];
    },
    enabled: !!caseId,
  });
}

export function useAddCasePlanItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      caseId,
      organisationId,
      patientId,
      problem,
      goalId,
      description,
      ownerId,
      deadline,
    }: {
      caseId: string;
      organisationId: string;
      patientId: string;
      problem: string | null;
      goalId: string | null;
      description: string;
      ownerId: string | null;
      deadline: string | null;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase.from("care_plan_interventions").insert({
        case_id: caseId,
        organisation_id: organisationId,
        patient_id: patientId,
        problem,
        goal_id: goalId,
        description,
        owner_id: ownerId,
        deadline,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: planItemsKey(variables.caseId) });
    },
  });
}

export function useRecordPlanItemOutcome() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, outcome }: { itemId: string; caseId: string; outcome: string }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("care_plan_interventions")
        .update({ outcome })
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: planItemsKey(variables.caseId) });
    },
  });
}

export function useRemoveCasePlanItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId }: { itemId: string; caseId: string }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("care_plan_interventions")
        .update({ status: "removed", removed_at: new Date().toISOString() })
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: planItemsKey(variables.caseId) });
    },
  });
}

export function useCaseBarriers(caseId: string) {
  return useQuery({
    queryKey: barriersKey(caseId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_management_barriers")
        .select("*")
        .eq("case_id", caseId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as CaseBarrier[];
    },
    enabled: !!caseId,
  });
}

export function useAddBarrier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      caseId,
      organisationId,
      patientId,
      category,
      description,
    }: {
      caseId: string;
      organisationId: string;
      patientId: string;
      category: CaseBarrier["category"];
      description: string;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase.from("care_management_barriers").insert({
        case_id: caseId,
        organisation_id: organisationId,
        patient_id: patientId,
        category,
        description,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: barriersKey(variables.caseId) });
    },
  });
}

export function useResolveBarrier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ barrierId }: { barrierId: string; caseId: string }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("care_management_barriers")
        .update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: user?.id ?? null })
        .eq("id", barrierId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: barriersKey(variables.caseId) });
    },
  });
}

export function useCaseEvents(caseId: string) {
  return useQuery({
    queryKey: eventsKey(caseId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_management_case_events")
        .select("*")
        .eq("case_id", caseId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as CaseEvent[];
    },
    enabled: !!caseId,
  });
}
