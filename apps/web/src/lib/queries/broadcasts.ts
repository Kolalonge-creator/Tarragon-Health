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
 * exact set admin_send_broadcast would enqueue to. Debounce-friendly: the caller
 * gates `enabled` on a chosen audience.
 */
export function useBroadcastAudienceCount(
  audience: BroadcastAudience | null,
  filter: BroadcastAudienceFilter
) {
  return useQuery({
    queryKey: ["broadcast-audience-count", audience, filter],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("admin_broadcast_audience_count", {
        p_audience: audience as BroadcastAudience,
        p_filter: filter as unknown as Json,
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
}

/**
 * Creates the broadcast row (RLS: admin, created_by = self) then calls
 * admin_send_broadcast to resolve the audience and enqueue notifications. The
 * two-step (persist then send) leaves an auditable record even if the send RPC
 * errors. Returns the recipient count reached.
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
        })
        .select("id")
        .single();
      if (insertError) throw insertError;

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
