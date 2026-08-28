import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { rankCases, type TriageResult } from "@/lib/triage/score";
import { generateCaseBriefAction } from "@/lib/case-briefs/actions";
import type { Database, EscalationLevel, Tables } from "@tarragon/shared";

export type AlertResolutionOutcome = Database["public"]["Enums"]["alert_resolution_outcome"];
export type AlertTypeCode = Database["public"]["Enums"]["alert_type_code"];
export type AlertCategory = Database["public"]["Enums"]["alert_category"];

export type ClinicianAlertWithPatient = Tables<"clinician_alerts"> & {
  patient: { full_name: string | null } | null;
  screening_result: { result_status: string } | null;
  responsible_clinician: { full_name: string } | null;
  backup_clinician: { full_name: string } | null;
  case_brief:
    | {
        status: "generated" | "failed";
        summary_text: string | null;
        suggested_action_text: string | null;
        draft_review_note: string | null;
        generated_at: string;
        protocol_version: { title: string; version_number: number } | null;
      }
    | null;
  /** Triage ranking, computed client-side — see lib/triage/score.ts. */
  triage: TriageResult;
};

/**
 * 8.2's Level 0-4 severity bucketed into the three-bucket inbox wireframe
 * (8.8: "URGENT n / HIGH n / ROUTINE n"). severity is populated server-side
 * by private.classify_and_assign_clinician_alert() — always derived from
 * level/override_level, never client-set.
 */
export function severityBucket(severity: number): "urgent" | "high" | "routine" {
  if (severity >= 4) return "urgent";
  if (severity === 3) return "high";
  return "routine";
}

const ALERT_SELECT =
  "*, patient:profiles!clinician_alerts_patient_id_fkey(full_name), screening_result:screening_results!clinician_alerts_screening_result_id_fkey(result_status), responsible_clinician:clinical_staff!clinician_alerts_responsible_clinician_id_fkey(full_name), backup_clinician:clinical_staff!clinician_alerts_backup_clinician_id_fkey(full_name), case_brief:case_briefs(status, summary_text, suggested_action_text, draft_review_note, generated_at, protocol_version:protocol_versions!case_briefs_protocol_version_id_fkey(title, version_number))";

/**
 * The open worklist, ranked by the triage engine rather than by severity+SLA
 * alone (compareAlerts, which remains the tiebreaker and the fallback).
 *
 * The extra signals the engine wants — how many times this patient has
 * escalated before, how many conditions they carry — are per-patient
 * aggregates. They are fetched as TWO queries for the whole worklist, never
 * one per row: an N+1 here would make the cockpit slower than the dashboard it
 * replaces, which would defeat the entire point of it.
 *
 * If either aggregate query fails, ranking degrades to severity+SLA rather
 * than breaking the worklist. A doctor with a slightly-less-cleverly-ordered
 * list is fine; a doctor with no list is not.
 */
export function useClinicianAlerts() {
  return useQuery({
    queryKey: ["clinician-alerts", "open"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinician_alerts")
        .select(ALERT_SELECT)
        .eq("status", "open")
        .order("sla_due_at", { ascending: true, nullsFirst: false });
      if (error) throw error;

      const alerts = data as Omit<ClinicianAlertWithPatient, "triage">[];
      const patientIds = Array.from(new Set(alerts.map((alert) => alert.patient_id)));

      const [priorEscalations, activeConditions] = await Promise.all([
        countByPatient(supabase, "escalations", patientIds),
        countByPatient(supabase, "care_plans", patientIds, { status: "active" }),
      ]);

      // One instant for the whole list, so ranking cannot shift between rows.
      const now = new Date();

      return rankCases(
        alerts,
        (alert) => ({
          level: alert.level,
          overrideLevel: alert.override_level,
          slaDueAt: alert.sla_due_at,
          createdAt: alert.created_at,
          screeningResultStatus: alert.screening_result?.result_status ?? null,
          priorEscalationCount: priorEscalations.get(alert.patient_id) ?? 0,
          activeConditionCount: activeConditions.get(alert.patient_id) ?? 0,
        }),
        now
      ).map(({ row, triage }) => ({ ...row, triage }) as ClinicianAlertWithPatient);
    },
    refetchInterval: 60_000,
  });
}

/**
 * Counts rows per patient across the whole worklist in one round trip.
 * Returns an empty map on failure — the caller degrades to severity+SLA
 * ranking rather than surfacing an error for a signal that only reorders.
 */
async function countByPatient(
  supabase: ReturnType<typeof createClient>,
  table: "escalations" | "care_plans",
  patientIds: string[],
  filter?: { status: "active" }
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (patientIds.length === 0) return counts;

  const base = supabase.from(table).select("patient_id").in("patient_id", patientIds);
  const { data, error } = await (filter ? base.eq("status", filter.status) : base);
  if (error) {
    console.error(`clinician-alerts: could not count ${table} for triage`, error);
    return counts;
  }

  for (const row of data ?? []) {
    counts.set(row.patient_id, (counts.get(row.patient_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Records a clinician's disagreement with the system's own deterministic
 * classification (clinician_alerts.level) — never overwrites `level`
 * itself, only the separate override_* fields. Server derives
 * overridden_by/overridden_at from the caller's own active clinical_staff
 * row (private.enforce_alert_override_clinical_only) — passing them here
 * is a no-op, the trigger always recomputes them.
 */
export function useOverrideAlertLevel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      alertId,
      overrideLevel,
      overrideReason,
    }: {
      alertId: string;
      overrideLevel: EscalationLevel;
      overrideReason: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("clinician_alerts")
        .update({ override_level: overrideLevel, override_reason: overrideReason })
        .eq("id", alertId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clinician-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
    },
  });
}

/** Clears a previously-set override, reverting display to the system's own classification. */
export function useClearAlertOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (alertId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("clinician_alerts")
        .update({ override_level: null })
        .eq("id", alertId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clinician-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
    },
  });
}

export function useAcknowledgeAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (alertId: string) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { error } = await supabase
        .from("clinician_alerts")
        .update({
          status: "acknowledged",
          acknowledged_by: user.id,
          acknowledged_at: new Date().toISOString(),
        })
        .eq("id", alertId);
      if (error) throw error;
    },
    onSuccess: (_data, alertId) => {
      queryClient.invalidateQueries({ queryKey: ["clinician-alerts", "open"] });
      // Fire-and-forget, same "same mechanism, different trigger" shape as
      // useClaimEscalation's on-claim generation — see lib/case-briefs/
      // generate.ts for the fail-open guarantee this relies on. If this
      // alert is later escalated to a doctor, useClaimEscalation reuses the
      // same brief rather than generating a second one.
      void generateCaseBriefAction(alertId).catch(() => {});
    },
  });
}

/**
 * 8.10: defers an alert with a required reason, which
 * private.stamp_clinician_alert_lifecycle() turns into both a status change
 * (-> 'snoozed', taking the alert off the open worklist) and a real
 * alert_follow_up_tasks row due at snoozeUntil — never just a client-side
 * hide. snoozed_by is server-derived, never sent from here.
 */
export function useSnoozeAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      alertId,
      snoozeUntil,
      reason,
    }: {
      alertId: string;
      snoozeUntil: string;
      reason: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("clinician_alerts")
        .update({ snoozed_until: snoozeUntil, snooze_reason: reason })
        .eq("id", alertId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clinician-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["alert-follow-up-tasks"] });
    },
  });
}

/** Ends a snooze early, returning the alert to the open worklist. */
export function useUnsnoozeAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (alertId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("clinician_alerts")
        .update({ snoozed_until: null })
        .eq("id", alertId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clinician-alerts"] });
    },
  });
}

/**
 * 8.12: resolves (or closes) an alert with the outcome documented.
 * clinician_alerts_resolution_requires_documentation (DB CHECK) is the real
 * enforcement boundary — resolutionAction/resolutionOutcome are required
 * params here purely so the UI can never even attempt the call without
 * them for a severity>=2 alert; the server is what actually blocks it.
 * resolved_by/resolved_at/closed_by/closed_at are server-derived.
 */
export function useResolveAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      alertId,
      resolutionAction,
      resolutionOutcome,
      close,
    }: {
      alertId: string;
      resolutionAction: string;
      resolutionOutcome: AlertResolutionOutcome;
      /** true closes the alert outright (the final accountability step, 8.3); false just resolves it. */
      close?: boolean;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("clinician_alerts")
        .update({
          status: close ? "closed" : "resolved",
          resolution_action: resolutionAction,
          resolution_outcome: resolutionOutcome,
        })
        .eq("id", alertId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clinician-alerts"] });
    },
  });
}

/**
 * 8.9's "previous trend" panel: prior clinician_alerts for the same patient
 * and type_code, most recent first. Deliberately excludes the alert being
 * viewed and caps at 90 days / 10 rows — a trend panel, not a full history
 * export.
 */
export function useAlertTrend(patientId: string | undefined, typeCode: string | undefined, excludeAlertId: string) {
  return useQuery({
    queryKey: ["clinician-alerts", "trend", patientId, typeCode, excludeAlertId],
    enabled: !!patientId && !!typeCode,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinician_alerts")
        .select("id, severity, status, title, created_at, resolution_outcome")
        .eq("patient_id", patientId as string)
        .eq("type_code", typeCode as AlertTypeCode)
        .neq("id", excludeAlertId)
        .gte("created_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });
}

/** Every open alert_follow_up_task for the org, soonest-due first — the queue snoozing (8.10) creates. */
export function useAlertFollowUpTasks() {
  return useQuery({
    queryKey: ["alert-follow-up-tasks", "open"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("alert_follow_up_tasks")
        .select(
          "*, patient:profiles!alert_follow_up_tasks_patient_id_fkey(full_name), clinician_alert:clinician_alerts!alert_follow_up_tasks_clinician_alert_id_fkey(title, status)"
        )
        .eq("status", "open")
        .order("due_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export function useResolveFollowUpTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, status }: { taskId: string; status: "done" | "dismissed" }) => {
      const supabase = createClient();
      const { error } = await supabase.from("alert_follow_up_tasks").update({ status }).eq("id", taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alert-follow-up-tasks"] });
    },
  });
}
