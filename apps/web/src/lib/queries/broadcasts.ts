import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import type { Enums, Json, Tables } from "@tarragon/shared";
import type { BroadcastEmailContent } from "@/lib/broadcasts/render-email-template";

export type NotificationBroadcast = Tables<"notification_broadcasts">;
export type BroadcastAudience = Enums<"broadcast_audience">;
export type NotificationChannel = Enums<"notification_channel">;
export type { BroadcastEmailContent };

export interface BroadcastAudienceFilter {
  state?: string;
  plan_code?: string;
  partner_type?: "pharmacy" | "specialist";
  // uuid strings — only used/required when audience === "specific_patients".
  patient_ids?: string[];
}

// ---- Specific-patient picker (admin_search_patients) -----------------------
const patientPickerResultSchema = z
  .array(
    z.object({
      id: z.string(),
      full_name: z.string().nullable(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
    })
  )
  .default([]);
export type PatientPickerResult = z.infer<typeof patientPickerResultSchema>[number];

/**
 * Search-as-you-type lookup for the "Specific patients" audience. Debounced
 * by the caller; mirrors usePatientSearch's min-2-chars gate
 * (apps/web/src/lib/analytics/queries.ts) but calls admin_search_patients
 * (admin-gated, includes email) rather than the analyst-gated
 * analytics_patient_search (which is missing email).
 */
export function useSearchPatients(query: string) {
  return useQuery({
    queryKey: ["broadcast-patient-search", query],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("admin_search_patients", {
        p_query: query,
      });
      if (error) throw error;
      return patientPickerResultSchema.parse(data);
    },
    enabled: query.trim().length >= 2,
  });
}

const historyKey = ["broadcasts"] as const;

/** Past broadcasts, newest first (admin-only via RLS). */
export function useBroadcastHistory() {
  return useQuery({
    queryKey: historyKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("notification_broadcasts")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as NotificationBroadcast[];
    },
  });
}

/**
 * Live preview of how many reachable recipients an audience resolves to — the
 * exact set admin_send_broadcast/private.execute_broadcast would enqueue to.
 * Debounce-friendly: the caller gates `enabled` on a chosen audience.
 * `marketing` mirrors the composer's "This is a marketing message" checkbox
 * (notification_broadcasts.is_marketing) so the estimate reacts live to it,
 * the same way it already reacts to audience/state/plan changes.
 */
export function useBroadcastAudienceCount(
  audience: BroadcastAudience | null,
  filter: BroadcastAudienceFilter,
  marketing: boolean
) {
  return useQuery({
    queryKey: ["broadcast-audience-count", audience, filter, marketing],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("admin_broadcast_audience_count", {
        p_audience: audience as BroadcastAudience,
        p_filter: filter as unknown as Json,
        p_marketing: marketing,
      });
      if (error) throw error;
      return data as number;
    },
    enabled: !!audience,
  });
}

/**
 * Best-effort server-side check for personal-result/diagnosis phrasing in a
 * draft broadcast (title + body). admin_send_broadcast enforces this itself
 * regardless of the UI, but calling it up front avoids leaving a blocked
 * draft row behind and gives the admin immediate, specific feedback.
 */
export function useBroadcastContentCheck() {
  return useMutation({
    mutationFn: async (text: string) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("admin_broadcast_content_check", {
        p_text: text,
      });
      if (error) throw error;
      return (data ?? []) as string[];
    },
  });
}

export interface SendBroadcastInput {
  title: string;
  body: string;
  audience: BroadcastAudience;
  filter: BroadcastAudienceFilter;
  channels: NotificationChannel[];
  // Branded template for the email channel only — null/undefined falls back
  // to admin_send_broadcast's plain title/body rendering (see
  // notification_broadcasts.email_content's column comment).
  emailContent?: BroadcastEmailContent | null;
  // Gates the audience through profiles.marketing_opt_in (private.
  // broadcast_targets' 4th param) — see admin_broadcast_audience_count above.
  isMarketing: boolean;
  // Send-later scheduling: when set, the row is inserted with scheduled_for
  // and admin_send_broadcast is never called — private.process_due_broadcasts
  // (a pg_cron job) picks it up once due. Undefined/null means "send now",
  // today's unchanged behaviour.
  scheduledFor?: string | null;
  // A/B testing: a second content variant + split percentage. Presence of
  // emailContentB is what turns on A/B mode for this broadcast.
  emailContentB?: BroadcastEmailContent | null;
  variantSplitPct?: number;
}

/**
 * Creates the broadcast row (RLS: admin, created_by = self) then, unless
 * scheduled for later, calls admin_send_broadcast to resolve the audience
 * and enqueue notifications. The two-step (persist then send) leaves an
 * auditable record even if the send RPC errors. Returns the recipient count
 * reached for a "send now" broadcast, or null for one scheduled for later
 * (nothing has actually gone out yet).
 */
export function useSendBroadcast() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SendBroadcastInput) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data: created, error: insertError } = await supabase
        .from("notification_broadcasts")
        .insert({
          created_by: user.id,
          title: input.title,
          body: input.body,
          audience: input.audience,
          audience_filter: input.filter as unknown as Json,
          channels: input.channels,
          email_content: (input.emailContent ?? null) as unknown as Json,
          is_marketing: input.isMarketing,
          scheduled_for: input.scheduledFor ?? null,
          email_content_b: (input.emailContentB ?? null) as unknown as Json,
          ...(input.variantSplitPct ? { variant_split_pct: input.variantSplitPct } : {}),
        })
        .select("id")
        .single();
      if (insertError) throw insertError;

      if (input.scheduledFor) {
        return null;
      }

      const { data: count, error: sendError } = await supabase.rpc("admin_send_broadcast", {
        p_broadcast_id: created.id,
      });
      if (sendError) throw sendError;
      return count as number;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: historyKey });
    },
  });
}

/** Cancels a still-pending scheduled broadcast before it fires — only valid
 * while status is still 'draft' and scheduled_for is set (enforced server-
 * side too). Clears scheduled_for, leaving an ordinary unsent draft behind. */
export function useCancelScheduledBroadcast() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (broadcastId: string) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("admin_cancel_scheduled_broadcast", {
        p_broadcast_id: broadcastId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: historyKey });
    },
  });
}

// ---- Per-broadcast open/click stats (admin_broadcast_stats) ----------------
const broadcastStatRowSchema = z.object({
  variant: z.string(),
  sent: z.number(),
  opened: z.number(),
  open_rate: z.number(),
  clicked: z.number(),
  click_rate: z.number(),
});
export type BroadcastStatRow = z.infer<typeof broadcastStatRowSchema>;

/** Open/click stats for one broadcast, broken down by A/B variant once A/B
 * testing is in use (variant is the literal string "all" otherwise). Fetched
 * on demand (see broadcast-composer.tsx's per-row "Show stats" toggle), not
 * as part of the main history list query, since it's a second round-trip
 * per broadcast. */
export function useBroadcastStats(broadcastId: string | null) {
  return useQuery({
    queryKey: ["broadcast-stats", broadcastId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("admin_broadcast_stats", {
        p_broadcast_id: broadcastId as string,
      });
      if (error) throw error;
      return z.array(broadcastStatRowSchema).parse(data);
    },
    enabled: !!broadcastId,
  });
}

// ---- Saved email-design template library (broadcast_email_templates) ------
export type BroadcastEmailTemplate = Tables<"broadcast_email_templates">;

/** An admin's saved, reusable broadcast email designs — distinct from the
 * platform's ~25 hardcoded system notification_templates (see the
 * broadcast_email_templates_library migration's table comment). */
export function useBroadcastEmailTemplates() {
  return useQuery({
    queryKey: ["broadcast-email-templates"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("broadcast_email_templates")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as BroadcastEmailTemplate[];
    },
  });
}

export function useSaveBroadcastEmailTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; content: BroadcastEmailContent }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase.from("broadcast_email_templates").insert({
        name: input.name,
        created_by: user.id,
        content: input.content as unknown as Json,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["broadcast-email-templates"] });
    },
  });
}

export function useDeleteBroadcastEmailTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = createClient();
      const { error } = await supabase.from("broadcast_email_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["broadcast-email-templates"] });
    },
  });
}
