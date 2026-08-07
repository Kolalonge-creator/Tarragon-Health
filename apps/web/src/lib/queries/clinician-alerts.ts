import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { rankCases, type TriageResult } from "@/lib/triage/score";
import { generateCaseBriefAction } from "@/lib/case-briefs/actions";
import type { EscalationLevel, Tables } from "@tarragon/shared";

export type ClinicianAlertWithPatient = Tables<"clinician_alerts"> & {
  patient: { full_name: string | null } | null;
  screening_result: { result_status: string } | null;
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

const ALERT_SELECT =
  "*, patient:profiles!clinician_alerts_patient_id_fkey(full_name), screening_result:screening_results!clinician_alerts_screening_result_id_fkey(result_status), case_brief:case_briefs(status, summary_text, suggested_action_text, draft_review_note, generated_at, protocol_version:protocol_versions!case_briefs_protocol_version_id_fkey(title, version_number))";

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
