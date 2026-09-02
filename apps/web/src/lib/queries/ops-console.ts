import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export type OpsTodaySummary = {
  generated_at: string;
  patients: number;
  active_care_programmes: number;
  active_subscriptions: number;
  appointments_today: number;
  consults_today: number;
  pending_clinical_reviews: number;
  critical_alerts: number;
  alerts_past_sla: number;
  open_escalations: number;
  unresolved_referrals: number;
  laboratory_delays: number;
  pharmacy_issues: number;
  pending_bookings: number;
  support_unread: number;
  failed_payments: number;
  reconciliation_exceptions: number;
  open_incidents: number;
  incidents_past_sla: number;
  clinician_verifications_pending: number;
};

export type OpsExceptionDomain =
  | "alerts"
  | "appointments"
  | "referrals"
  | "laboratory"
  | "pharmacy"
  | "support"
  | "payments"
  | "incidents"
  | "providers";

export type OpsExceptionSeverity = "critical" | "urgent" | "high";

export type OpsExceptionRow = {
  domain: OpsExceptionDomain;
  entity_id: string;
  entity_type: string;
  severity: OpsExceptionSeverity;
  severity_rank: number;
  headline: string;
  detail: string;
  subject_name: string | null;
  subject_id: string | null;
  opened_at: string;
  age_hours: number;
  due_at: string | null;
  href: string;
};

export type OpsExceptionCounts = {
  total: number;
  by_domain: Partial<Record<OpsExceptionDomain, number>>;
  by_severity: Partial<Record<OpsExceptionSeverity, number>>;
};

export type OpsHealthStatus = "operational" | "degraded" | "down";

export type OpsHealthComponent = {
  key: string;
  label: string;
  status: OpsHealthStatus;
  detail: string;
  metric: Record<string, number> | null;
};

export type OpsSystemHealth = {
  generated_at: string;
  components: OpsHealthComponent[];
};

/**
 * The master admin console's cross-domain operational view (spec 97.2) — all
 * four RPCs return '{}'/'[]' (private.can_view_ops_console() = is_analyst() OR
 * has_permission('ops.console.view')) for a caller without access rather than
 * erroring, so these are safe to call unconditionally; an unauthorised caller
 * just sees an empty dashboard.
 */
export function useOpsTodaySummary() {
  return useQuery({
    queryKey: ["ops-today-summary"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("ops_today_summary");
      if (error) throw error;
      return data as unknown as OpsTodaySummary;
    },
    refetchInterval: 60_000,
  });
}

export function useOpsExceptionQueue(domain: OpsExceptionDomain | "all") {
  return useQuery({
    queryKey: ["ops-exception-queue", domain],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("ops_exception_queue", {
        // p_domain has a SQL DEFAULT (null), so omitting the key (via undefined)
        // is genuinely equivalent to passing null — PostgREST drops undefined
        // keys from the request body. See reference_rpc_args_null_typegen_regression.
        p_domain: domain === "all" ? undefined : domain,
        p_limit: 200,
      });
      if (error) throw error;
      return (data ?? []) as unknown as OpsExceptionRow[];
    },
    refetchInterval: 60_000,
  });
}

export function useOpsExceptionCounts() {
  return useQuery({
    queryKey: ["ops-exception-counts"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("ops_exception_counts");
      if (error) throw error;
      return data as unknown as OpsExceptionCounts;
    },
    refetchInterval: 60_000,
  });
}

export function useOpsSystemHealth() {
  return useQuery({
    queryKey: ["ops-system-health"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("ops_system_health");
      if (error) throw error;
      return data as unknown as OpsSystemHealth;
    },
    refetchInterval: 60_000,
  });
}
