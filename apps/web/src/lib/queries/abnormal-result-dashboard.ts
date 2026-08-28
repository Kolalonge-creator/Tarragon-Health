import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { compareAlerts } from "@/lib/worklist/priority";
import { deriveCaseStatus, ownerDisplayName, type CaseStatus } from "@/lib/abnormal-results/case-status";
import type { Tables } from "@tarragon/shared";

/** §7.17 — Critical/Urgent/High/Routine open-case counts + Unacknowledged/Overdue, one org. */
export interface AbnormalResultDashboardCounts {
  critical: number;
  urgent: number;
  high: number;
  routine: number;
  unacknowledged: number;
  overdue: number;
  unclaimed: number;
}

const EMPTY_COUNTS: AbnormalResultDashboardCounts = {
  critical: 0,
  urgent: 0,
  high: 0,
  routine: 0,
  unacknowledged: 0,
  overdue: 0,
  unclaimed: 0,
};

export function useAbnormalResultDashboardCounts(organisationId: string) {
  return useQuery({
    queryKey: ["abnormal-result-dashboard", "counts", organisationId],
    queryFn: async (): Promise<AbnormalResultDashboardCounts> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("abnormal_result_dashboard_counts", {
        p_organisation_id: organisationId,
      });
      if (error) throw error;
      const counts = (data ?? {}) as Partial<AbnormalResultDashboardCounts>;
      return { ...EMPTY_COUNTS, ...counts };
    },
    refetchInterval: 60_000,
  });
}

export type AbnormalResultCase = Tables<"clinician_alerts"> & {
  patient: { full_name: string | null } | null;
  caseStatus: CaseStatus;
  ownerName: string;
};

/**
 * The worklist behind the dashboard counts, ranked by the same severity+SLA
 * ordering as the clinician's own worklist (compareAlerts), with a unified
 * Owner/Status column per case — see lib/abnormal-results/case-status.ts for
 * why this is computed here rather than being a column on any one table.
 * escalations/lab_result_documents are fetched as two extra batched queries
 * for the whole worklist, never per-row, same discipline as
 * lib/queries/clinician-alerts.ts's own countByPatient.
 */
export function useAbnormalResultDashboardCases() {
  return useQuery({
    queryKey: ["abnormal-result-dashboard", "cases"],
    queryFn: async (): Promise<AbnormalResultCase[]> => {
      const supabase = createClient();
      const { data: alerts, error } = await supabase
        .from("clinician_alerts")
        .select("*, patient:profiles!clinician_alerts_patient_id_fkey(full_name)")
        .eq("status", "open")
        .order("sla_due_at", { ascending: true, nullsFirst: false });
      if (error) throw error;

      const rows = alerts ?? [];
      const alertIds = rows.map((a) => a.id);

      const [{ data: escalations }, { data: documents }] =
        alertIds.length > 0
          ? await Promise.all([
              supabase
                .from("escalations")
                .select("clinician_alert_id, status, assigned_doctor_id")
                .in("clinician_alert_id", alertIds),
              supabase
                .from("lab_result_documents")
                .select("clinician_alert_id, acknowledgement_status")
                .in("clinician_alert_id", alertIds),
            ])
          : [{ data: [] }, { data: [] }];

      const escalationByAlert = new Map(
        (escalations ?? [])
          .filter((e) => e.clinician_alert_id)
          .map((e) => [e.clinician_alert_id as string, e])
      );
      const documentByAlert = new Map(
        (documents ?? [])
          .filter((d) => d.clinician_alert_id)
          .map((d) => [d.clinician_alert_id as string, d])
      );

      const withStatus = rows.map((alert) => {
        const escalation = escalationByAlert.get(alert.id) ?? null;
        const resultDocument = documentByAlert.get(alert.id) ?? null;
        const caseStatus = deriveCaseStatus({
          alert: { status: alert.status, acknowledged_by: alert.acknowledged_by },
          escalation: escalation
            ? { status: escalation.status, assigned_doctor_id: escalation.assigned_doctor_id }
            : null,
          resultDocument: resultDocument
            ? { acknowledgement_status: resultDocument.acknowledgement_status }
            : null,
        });
        return { alert, caseStatus };
      });

      const ownerIds = Array.from(
        new Set(withStatus.map((w) => w.caseStatus.ownerId).filter((id): id is string => id !== null))
      );
      const { data: owners } =
        ownerIds.length > 0
          ? await supabase.from("profiles").select("id, full_name").in("id", ownerIds)
          : { data: [] as { id: string; full_name: string | null }[] };
      const ownerNameById = new Map((owners ?? []).map((o) => [o.id, o.full_name]));

      return withStatus
        .map(({ alert, caseStatus }) => ({
          ...alert,
          caseStatus,
          ownerName: ownerDisplayName(
            caseStatus.ownerId,
            caseStatus.ownerId ? (ownerNameById.get(caseStatus.ownerId) ?? null) : null
          ),
        }))
        .sort((a, b) => compareAlerts(a, b));
    },
    refetchInterval: 60_000,
  });
}
