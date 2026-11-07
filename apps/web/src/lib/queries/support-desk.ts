import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import type { WorkItem } from "@/lib/support-desk/model";

/**
 * Support desk data (SUP-1..SUP-3). Every read goes through the caller's own RLS: support_work_items is a security-invoker
 * view, and the desk's own tables are gated by private.is_support_staff / is_support_lead. Writes go through the RPCs.
 */

export type SupportHandoff = Tables<"support_handoffs">;
export type SupportTemplate = Tables<"support_response_templates">;
export type SlaPolicy = Tables<"support_sla_policies">;
export type BusinessHours = Tables<"support_business_hours">;
export type PublicHoliday = Tables<"support_public_holidays">;

export type DeskSummary = {
  days: number;
  open: number;
  unassigned: number;
  received_today: number;
  resolved_today: number;
  breached: number;
  at_risk: number;
  awaiting_customer: number;
  awaiting_internal: number;
  received: number;
  resolved: number;
  median_first_response_min: number | null;
  median_resolution_min: number | null;
  sla_measured: number;
  sla_compliance_pct: number | null;
  csat_count: number;
  csat_avg: number | null;
  prev_received: number;
  prev_resolved: number;
  prev_median_first_response_min: number | null;
};

export const deskKeys = {
  items: () => ["support-desk", "items"] as const,
  summary: (days: number) => ["support-desk", "summary", days] as const,
  staff: () => ["support-desk", "staff"] as const,
  handoffs: (scope: string) => ["support-desk", "handoffs", scope] as const,
  templates: () => ["support-desk", "templates"] as const,
  sla: () => ["support-desk", "sla"] as const,
};

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/** Every open item, plus anything received in the last 90 days (for the resolved and closed tabs). */
export function useSupportWorkItems() {
  return useQuery({
    queryKey: deskKeys.items(),
    queryFn: async () => {
      const supabase = createClient();
      const since = new Date(Date.now() - NINETY_DAYS_MS).toISOString();
      const { data, error } = await supabase
        .from("support_work_items")
        .select("*")
        .or(`status_group.not.in.(resolved,closed),received_at.gte.${since}`)
        .order("received_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as WorkItem[];
    },
    refetchInterval: 60_000,
  });
}

export function useSupportDeskSummary(days: number) {
  return useQuery({
    queryKey: deskKeys.summary(days),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("support_desk_summary", { p_days: days });
      if (error) throw error;
      return data as unknown as DeskSummary;
    },
    refetchInterval: 120_000,
  });
}

export function useSupportDeskStaff() {
  return useQuery({
    queryKey: deskKeys.staff(),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("list_support_desk_staff");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

export function useAssignWorkItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { items: { source: string; itemId: string }[]; assignee: string | null }) => {
      const supabase = createClient();
      const results = await Promise.all(
        input.items.map((it) =>
          supabase.rpc("assign_support_work_item", { p_source: it.source, p_item_id: it.itemId, p_assignee: input.assignee }),
        ),
      );
      const failures = results.flatMap((r) => (r.error ? [r.error.message] : []));
      if (failures.length > 0) {
        throw new Error(
          failures.length === input.items.length
            ? failures[0] ?? "Could not assign"
            : `${input.items.length - failures.length} assigned, ${failures.length} not: ${failures[0] ?? ""}`,
        );
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["support-desk"] }),
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Hand-offs
// ---------------------------------------------------------------------------------------------------------------------

/** Hand-offs for one support item (the support side), or every open one the caller may receive (scope "inbox"). */
export function useSupportHandoffs(scope: { source: string; sourceId: string } | "inbox" | "all") {
  const key = typeof scope === "string" ? scope : `${scope.source}:${scope.sourceId}`;
  return useQuery({
    queryKey: deskKeys.handoffs(key),
    queryFn: async () => {
      const supabase = createClient();
      let q = supabase.from("support_handoffs").select("*").order("raised_at", { ascending: false }).limit(500);
      if (typeof scope !== "string") q = q.eq("source", scope.source).eq("source_id", scope.sourceId);
      if (scope === "inbox") q = q.in("status", ["open", "acknowledged"]);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 60_000,
  });
}

export function useRaiseHandoff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { source: string; sourceId: string; destination: string; reason: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("raise_support_handoff", {
        p_source: input.source,
        p_source_id: input.sourceId,
        p_destination: input.destination,
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["support-desk"] }),
  });
}

export function useHandoffAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input:
        | { kind: "acknowledge"; id: string }
        | { kind: "outcome"; id: string; outcome: string; customerMessage: string; refundId?: string | null; incidentId?: string | null }
        | { kind: "withdraw"; id: string; reason: string },
    ) => {
      const supabase = createClient();
      const { error } =
        input.kind === "acknowledge"
          ? await supabase.rpc("acknowledge_support_handoff", { p_handoff_id: input.id })
          : input.kind === "outcome"
            ? await supabase.rpc("record_support_handoff_outcome", {
                p_handoff_id: input.id,
                p_outcome: input.outcome,
                p_customer_message: input.customerMessage || null,
                p_refund_id: input.refundId ?? null,
                p_ops_incident_id: input.incidentId ?? null,
              })
            : await supabase.rpc("withdraw_support_handoff", { p_handoff_id: input.id, p_reason: input.reason });
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["support-desk"] }),
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Reply templates
// ---------------------------------------------------------------------------------------------------------------------

/** A support lead sees drafts too; an agent sees approved templates only (RLS). */
export function useSupportTemplates() {
  return useQuery({
    queryKey: deskKeys.templates(),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("support_response_templates")
        .select("*")
        .neq("status", "retired")
        .order("title");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; title: string; body: string; category: string | null; createdBy: string }) => {
      const supabase = createClient();
      const { error } = input.id
        ? await supabase.from("support_response_templates").update({ title: input.title, body: input.body, category: input.category }).eq("id", input.id)
        : await supabase
            .from("support_response_templates")
            .insert({ title: input.title, body: input.body, category: input.category, created_by: input.createdBy });
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: deskKeys.templates() }),
  });
}

export function useTemplateAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { kind: "approve" | "retire"; id: string }) => {
      const supabase = createClient();
      const { error } =
        input.kind === "approve"
          ? await supabase.rpc("approve_support_response_template", { p_template_id: input.id })
          : await supabase.from("support_response_templates").update({ status: "retired" }).eq("id", input.id);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: deskKeys.templates() }),
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// SLA settings
// ---------------------------------------------------------------------------------------------------------------------

export function useSlaSettings() {
  return useQuery({
    queryKey: deskKeys.sla(),
    queryFn: async () => {
      const supabase = createClient();
      const [policies, hours, holidays] = await Promise.all([
        supabase.from("support_sla_policies").select("*").order("priority").order("version", { ascending: false }),
        supabase.from("support_business_hours").select("*").order("weekday"),
        supabase.from("support_public_holidays").select("*").order("holiday_date"),
      ]);
      if (policies.error) throw policies.error;
      if (hours.error) throw hours.error;
      if (holidays.error) throw holidays.error;
      return { policies: policies.data ?? [], hours: hours.data ?? [], holidays: holidays.data ?? [] };
    },
  });
}

export function useSlaSettingsAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input:
        | { kind: "policy"; priority: string; clock: string; firstResponseMinutes: number; resolutionMinutes: number | null; changeNote: string }
        | { kind: "hours"; weekday: number; opens: string | null; closes: string | null; updatedBy: string }
        | { kind: "add_holiday"; date: string; name: string; createdBy: string }
        | { kind: "remove_holiday"; date: string },
    ) => {
      const supabase = createClient();
      let error: { message: string } | null = null;
      if (input.kind === "policy") {
        ({ error } = await supabase.rpc("set_support_sla_policy", {
          p_priority: input.priority,
          p_clock: input.clock,
          p_first_response_minutes: input.firstResponseMinutes,
          p_resolution_minutes: input.resolutionMinutes,
          p_change_note: input.changeNote,
        }));
      } else if (input.kind === "hours") {
        ({ error } =
          input.opens && input.closes
            ? await supabase
                .from("support_business_hours")
                .upsert({ weekday: input.weekday, opens: input.opens, closes: input.closes, updated_by: input.updatedBy, updated_at: new Date().toISOString() })
            : await supabase.from("support_business_hours").delete().eq("weekday", input.weekday));
      } else if (input.kind === "add_holiday") {
        ({ error } = await supabase.from("support_public_holidays").insert({ holiday_date: input.date, name: input.name, created_by: input.createdBy }));
      } else {
        ({ error } = await supabase.from("support_public_holidays").delete().eq("holiday_date", input.date));
      }
      if (error) throw new Error(error.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["support-desk"] }),
  });
}
