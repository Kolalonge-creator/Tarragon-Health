import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { compareAlerts } from "@/lib/worklist/priority";
import { severityBucket } from "@/lib/queries/clinician-alerts";
import type { Database, Tables } from "@tarragon/shared";

export type AlertCategory = Database["public"]["Enums"]["alert_category"];
export type AlertTypeCode = Database["public"]["Enums"]["alert_type_code"];

/**
 * Operations & Command Centre §96.6 "clinical operations queue": the 4
 * category buckets the spec asks for, mapped onto the taxonomy
 * clinician_alerts already carries (category/type_code) rather than a new
 * schema of our own -- see 20260828013011_alert_system_taxonomy_and_governance.sql
 * for the full type_code list. "other" is a 5th bucket for anything the spec
 * doesn't name (operational alerts, refill_due/potential_interaction) --
 * deliberately shown rather than silently dropped.
 */
export type OperationsQueueBucket =
  | "critical_result"
  | "medication_concern"
  | "specialist_delay"
  | "overdue_follow_up"
  | "other";

const OVERDUE_FOLLOW_UP_TYPES: AlertTypeCode[] = ["missed_appointment", "overdue_task", "overdue_monitoring"];

export function bucketForAlert(alert: { category: AlertCategory | null; type_code: AlertTypeCode | null }): OperationsQueueBucket {
  if (alert.category === "clinical") return "critical_result";
  if (alert.category === "medication") return "medication_concern";
  if (alert.type_code === "failed_referral") return "specialist_delay";
  if (alert.type_code && OVERDUE_FOLLOW_UP_TYPES.includes(alert.type_code)) return "overdue_follow_up";
  return "other";
}

/** Matches the clinician inbox's own Critical/High/Routine tiers (severityBucket) so the two never disagree. */
export const TIER_LABEL: Record<ReturnType<typeof severityBucket>, string> = {
  urgent: "Critical",
  high: "High",
  routine: "Routine",
};

export type OperationsQueueAlert = Tables<"clinician_alerts"> & {
  patient: { full_name: string | null } | null;
  responsible_clinician: { full_name: string } | null;
  backup_clinician: { full_name: string } | null;
};

const OPERATIONS_QUEUE_ALERT_SELECT =
  "*, patient:profiles!clinician_alerts_patient_id_fkey(full_name), responsible_clinician:clinical_staff!clinician_alerts_responsible_clinician_id_fkey(full_name), backup_clinician:clinical_staff!clinician_alerts_backup_clinician_id_fkey(full_name)";

/** Every open clinician_alerts row, sorted severity-then-SLA within each bucket by the caller. */
export function useOperationsQueueAlerts() {
  return useQuery({
    queryKey: ["operations-queue", "alerts"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinician_alerts")
        .select(OPERATIONS_QUEUE_ALERT_SELECT)
        .eq("status", "open")
        .order("created_at", { ascending: true });
      if (error) throw error;
      const alerts = data as OperationsQueueAlert[];
      return alerts.slice().sort(compareAlerts);
    },
    refetchInterval: 60_000,
  });
}

export type OverdueReferralGap = {
  patient_id: string;
  organisation_id: string;
  opened_at: string;
  detail: { referral_id?: string; referral_number?: string | null; status?: string; specialist_type?: string };
  patient: { full_name: string | null } | null;
};

/**
 * patient_care_gaps is a plain view (no FK constraints PostgREST can embed
 * a `profiles!...` join against), so patient names are resolved in a
 * second, batched query -- same two-step shape as
 * lib/queries/clinician-alerts.ts's countByPatient, not one query per row.
 */
export function useOverdueReferralGaps() {
  return useQuery({
    queryKey: ["operations-queue", "overdue-referral-gaps"],
    queryFn: async () => {
      const supabase = createClient();
      const { data: gaps, error } = await supabase
        .from("patient_care_gaps")
        .select("patient_id, organisation_id, opened_at, detail")
        .eq("gap_type", "overdue_referral")
        .order("opened_at", { ascending: true });
      if (error) throw error;
      const rows = (gaps ?? []) as Omit<OverdueReferralGap, "patient">[];

      const patientIds = Array.from(new Set(rows.map((r) => r.patient_id)));
      const patientNames = new Map<string, string | null>();
      if (patientIds.length > 0) {
        const { data: profiles, error: profileError } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", patientIds);
        if (profileError) throw profileError;
        for (const p of profiles ?? []) patientNames.set(p.id, p.full_name);
      }

      return rows.map((r) => ({
        ...r,
        patient: { full_name: patientNames.get(r.patient_id) ?? null },
      }));
    },
  });
}

/** Org-wide care-gap counts by type, for the queue page's situational-awareness header. */
export function useCareGapCounts() {
  return useQuery({
    queryKey: ["operations-queue", "care-gap-counts"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.from("patient_care_gaps").select("gap_type");
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        if (!row.gap_type) continue;
        counts.set(row.gap_type, (counts.get(row.gap_type) ?? 0) + 1);
      }
      return Array.from(counts.entries())
        .map(([gap_type, count]) => ({ gap_type, count }))
        .sort((a, b) => b.count - a.count);
    },
  });
}
