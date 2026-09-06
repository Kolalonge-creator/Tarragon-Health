import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export type AiAcceptanceCriteria = {
  system_id: string;
  system_code: string;
  criteria: {
    purpose: boolean;
    owner: boolean;
    risk_classification: boolean;
    validation: boolean;
    guardrails: boolean;
    monitoring: boolean;
    audit: boolean;
    rollback: boolean;
  };
  satisfied: boolean;
  outstanding: string[];
  owner_assigned: boolean;
  grandfathered: boolean;
};

export type AiGovernanceSystem = {
  system_code: string;
  name: string;
  risk_class: string | null;
  autonomy_level: string | null;
  lifecycle_status: string;
  is_enabled: boolean;
  grandfathered: boolean;
  next_review_due: string | null;
  approved_version: number | null;
  active_prompt_version: number | null;
  interactions: number;
  human_overrides: number;
  incidents: number;
  acceptance: AiAcceptanceCriteria | null;
};

export type AiGovernanceDashboard = {
  window_days: number;
  since: string;
  scope: "platform" | "organisation";
  totals: {
    interactions: number;
    escalations: number;
    human_overrides: number;
    high_risk_outputs: number;
    flagged_for_review: number;
    blocked_by_guardrail: number;
    fallbacks: number;
    failures: number;
  };
  incidents: {
    total: number;
    open: number;
    critical_open: number;
    with_patient_harm: number;
  };
  monitoring: {
    unacknowledged_model_changes: number;
    drift_breaches: number;
    material_disparities: number;
    systems_overdue_review: number;
  };
  systems: AiGovernanceSystem[];
};

/**
 * ai_governance_dashboard()'s systems[] carries system_code but not the row
 * id set_ai_system_enabled() needs — a separate, minimal lookup rather than
 * changing the dashboard RPC's return shape (it's shared with a real
 * analytics consumer already; narrowing this session's change to purely
 * additive). RLS on ai_systems is broad-authenticated-read (non-sensitive
 * catalogue metadata), same posture as service_regions/permissions.
 */
export function useAiSystemIds() {
  return useQuery({
    queryKey: ["ai-systems-ids"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.from("ai_systems").select("id, system_code");
      if (error) throw error;
      const map = new Map<string, string>();
      for (const row of data ?? []) map.set(row.system_code, row.id);
      return map;
    },
  });
}

/**
 * 97.19's platform-wide rollback surface — currently the only one that
 * exists: public.set_ai_system_enabled() operates exclusively on
 * public.ai_systems, so this UI is scoped to AI systems only, not a
 * general "disable any config" kill switch (no such thing exists yet for
 * a clinical rule, price, or notification template).
 */
export function useAiGovernanceDashboard(days = 30) {
  return useQuery({
    queryKey: ["ai-governance-dashboard", days],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("ai_governance_dashboard", { p_days: days });
      if (error) throw error;
      return data as unknown as AiGovernanceDashboard;
    },
  });
}

/**
 * The kill switch itself. Enabling is blocked server-side unless every
 * acceptance-criteria item is satisfied (see AiAcceptanceCriteria) — the
 * error message names exactly which ones are outstanding. Disabling
 * requires a non-empty reason and pages every active Clinical Director
 * plus every admin immediately (an in-app critical notification), so this
 * is never a silent flip.
 */
export function useSetAiSystemEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, enabled, reason }: { id: string; enabled: boolean; reason: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("set_ai_system_enabled", {
        p_id: id,
        p_enabled: enabled,
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-governance-dashboard"] });
    },
  });
}
