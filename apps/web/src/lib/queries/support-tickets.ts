import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Enums, Tables } from "@tarragon/shared";

export type SupportTicket = Tables<"support_tickets">;
export type SupportTicketComment = Tables<"support_ticket_comments">;
export type SupportTicketCategory = Enums<"support_ticket_category">;
export type SupportTicketPriority = Enums<"support_ticket_priority">;
export type SupportTicketStatus = Enums<"support_ticket_status">;

export const ticketKeys = {
  mine: (patientId: string) => ["support-tickets", "mine", patientId] as const,
  queue: () => ["support-tickets", "queue"] as const,
  detail: (ticketId: string) => ["support-tickets", "detail", ticketId] as const,
  comments: (ticketId: string) => ["support-ticket-comments", ticketId] as const,
};

const TICKET_SELECT =
  "*, patient:profiles!support_tickets_patient_id_fkey(full_name), assigned_staff:profiles!support_tickets_assigned_to_fkey(full_name)";

export type SupportTicketWithNames = SupportTicket & {
  patient: { full_name: string | null } | null;
  assigned_staff: { full_name: string | null } | null;
};

/** A patient's own tickets, most recent first. */
export function useMySupportTickets(patientId: string) {
  return useQuery({
    queryKey: ticketKeys.mine(patientId),
    enabled: !!patientId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("support_tickets")
        .select(TICKET_SELECT)
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as SupportTicketWithNames[];
    },
  });
}

/** The org-staff queue — every ticket not yet resolved/closed, priority then age. */
export function useSupportTicketQueue() {
  return useQuery({
    queryKey: ticketKeys.queue(),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("support_tickets")
        .select(TICKET_SELECT)
        .not("status", "in", "(resolved,closed)")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as SupportTicketWithNames[];
    },
    refetchInterval: 60_000,
  });
}

export function useSupportTicket(ticketId: string | undefined) {
  return useQuery({
    queryKey: ticketKeys.detail(ticketId ?? ""),
    enabled: !!ticketId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("support_tickets")
        .select(TICKET_SELECT)
        .eq("id", ticketId as string)
        .single();
      if (error) throw error;
      return data as SupportTicketWithNames;
    },
  });
}

export function useSupportTicketComments(ticketId: string | undefined) {
  return useQuery({
    queryKey: ticketKeys.comments(ticketId ?? ""),
    enabled: !!ticketId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("support_ticket_comments")
        .select("*, author:profiles!support_ticket_comments_author_profile_id_fkey(full_name)")
        .eq("ticket_id", ticketId as string)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as (SupportTicketComment & { author: { full_name: string | null } | null })[];
    },
  });
}

function invalidateTicket(queryClient: ReturnType<typeof useQueryClient>, ticketId: string) {
  queryClient.invalidateQueries({ queryKey: ticketKeys.detail(ticketId) });
  queryClient.invalidateQueries({ queryKey: ticketKeys.comments(ticketId) });
  queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
}

export function useAddTicketComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ticketId: string; body: string; isInternal?: boolean }) => {
      const supabase = createClient();
      // organisation_id/author_role are server-derived by
      // private.enforce_support_ticket_comment_author() (BEFORE INSERT) from
      // the ticket + caller — whatever is sent here is always overwritten,
      // same "passing it is a no-op" discipline as clinician-alerts.ts's
      // resolved_by/overridden_by. organisation_id must be a real SQL NULL
      // (cast past the generated Insert type's non-nullable `string`, same
      // narrowing pattern useAssignTicket uses below) — an empty string
      // fails uuid-cast at the PostgREST layer before the BEFORE INSERT
      // trigger ever runs, unlike NULL, which is valid for any column type
      // until the NOT NULL check runs (after the trigger has already
      // overwritten it). Found via an actual browser click-through: the
      // insert 400'd silently, which is exactly the gap PR #290's own
      // description flagged as unverified.
      const { error } = await supabase.from("support_ticket_comments").insert({
        ticket_id: input.ticketId,
        body: input.body,
        is_internal: input.isInternal ?? false,
        organisation_id: null as unknown as string,
        author_role: "patient",
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => invalidateTicket(queryClient, variables.ticketId),
  });
}

/** §24.5's state-machine transition RPC. */
export function useAdvanceTicketStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ticketId: string; to: SupportTicketStatus; note?: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("advance_support_ticket_status", {
        p_ticket_id: input.ticketId,
        p_to: input.to,
        p_note: input.note,
      });
      if (error) throw error;
      return data as SupportTicket;
    },
    onSuccess: (_data, variables) => invalidateTicket(queryClient, variables.ticketId),
  });
}

export function useAssignTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ticketId: string; assigneeId: string | null }) => {
      const supabase = createClient();
      // p_assignee_id is a genuinely nullable uuid param (unassigning passes
      // null) — Supabase's generated Args type has no way to express
      // "nullable but required", so it types this as plain `string`. The
      // narrowing cast is safe: PostgREST sends the real value either way.
      const { data, error } = await supabase.rpc("assign_support_ticket", {
        p_ticket_id: input.ticketId,
        p_assignee_id: input.assigneeId as string,
      });
      if (error) throw error;
      return data as SupportTicket;
    },
    onSuccess: (_data, variables) => invalidateTicket(queryClient, variables.ticketId),
  });
}

/** §24.9's Tier 1 -> Tier 2 -> Engineering ladder. */
export function useBumpTechnicalTier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ticketId: string) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("bump_support_ticket_technical_tier", { p_ticket_id: ticketId });
      if (error) throw error;
      return data as SupportTicket;
    },
    onSuccess: (_data, ticketId) => invalidateTicket(queryClient, ticketId),
  });
}

/** §24.7/24.8's clinical escalation — gated server-side to clinical-tier staff. */
export function useEscalateTicketToClinical() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ticketId: string; note: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("escalate_support_ticket_to_clinical", {
        p_ticket_id: input.ticketId,
        p_note: input.note,
      });
      if (error) throw error;
      return data as SupportTicket;
    },
    onSuccess: (_data, variables) => invalidateTicket(queryClient, variables.ticketId),
  });
}

/** Post-resolution CSAT — patient-only, once, per the support_tickets CHECK constraints. */
export function useRateTicketSatisfaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ticketId: string; score: number; comment?: string }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("support_tickets")
        .update({ satisfaction_score: input.score, satisfaction_comment: input.comment ?? null })
        .eq("id", input.ticketId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => invalidateTicket(queryClient, variables.ticketId),
  });
}
