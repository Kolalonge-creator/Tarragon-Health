import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type ServiceRegion = Tables<"service_regions">;

/** Partner-dependent services gated by the state rollout. Mirrors the DB check literals. */
export type RegionServiceType = "lab" | "pharmacy" | "home_visit" | "delivery" | "specialist";

/**
 * All service regions (36 states + FCT), ordered for a dropdown. Read by the signup /
 * location state pickers and the admin toggle page. Authenticated read (RLS) — every
 * signed-in user can see the canonical list and which states are live.
 */
export function useServiceRegions() {
  return useQuery({
    queryKey: ["service-regions"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("service_regions")
        .select("*")
        .order("display_name", { ascending: true });
      if (error) throw error;
      return data as ServiceRegion[];
    },
  });
}

/**
 * Whether a partner-dependent service is actually deliverable in a state — the single gate
 * predicate (public.region_service_available): the state's master switch is on AND an active
 * partner of that service type exists there. Disabled until a state is known. Used by
 * RegionGate to decide between the real booking UI and the "coming soon + notify me" card.
 */
export function useRegionServiceAvailable(
  state: string | null | undefined,
  service: RegionServiceType,
) {
  return useQuery({
    queryKey: ["region-service-available", state ?? "", service],
    enabled: Boolean(state),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("region_service_available", {
        p_state: state as string,
        p_service: service,
      });
      if (error) throw error;
      return Boolean(data);
    },
  });
}

/**
 * Join the waitlist for a partner service in a not-yet-live state. requester_id is derived
 * server-side from the session (RLS with_check requires requester_id = auth.uid()), so the
 * caller never supplies it. care_recipient_id is set when the request is on behalf of a
 * family member (the gated state is theirs, the alert goes to the requester).
 */
export function useJoinRegionWaitlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      state: string;
      serviceType: RegionServiceType;
      careRecipientId?: string | null;
      toEmail?: string | null;
      toPhone?: string | null;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { error } = await supabase.from("region_waitlist").insert({
        requester_id: user.id,
        care_recipient_id: input.careRecipientId ?? null,
        state: input.state,
        service_type: input.serviceType,
        to_email: input.toEmail ?? null,
        to_phone: input.toPhone ?? null,
      });
      // 23505 = already on the open waitlist for this state+service; treat as success.
      if (error && error.code !== "23505") throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["region-waitlist"] });
      queryClient.invalidateQueries({
        queryKey: ["region-waitlist", "mine", variables.state, variables.serviceType],
      });
    },
  });
}

/**
 * Whether the current user already has an open waitlist row for this state + service —
 * lets RegionGate show "you're on the list" instead of the join button on revisit.
 */
export function useMyOpenWaitlist(
  state: string | null | undefined,
  service: RegionServiceType,
  careRecipientId?: string | null,
) {
  return useQuery({
    queryKey: ["region-waitlist", "mine", state ?? "", service, careRecipientId ?? ""],
    enabled: Boolean(state),
    queryFn: async () => {
      const supabase = createClient();
      let query = supabase
        .from("region_waitlist")
        .select("id")
        .eq("state", state as string)
        .eq("service_type", service)
        .is("notified_at", null);
      query = careRecipientId
        ? query.eq("care_recipient_id", careRecipientId)
        : query.is("care_recipient_id", null);
      const { data, error } = await query.limit(1);
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
  });
}

// --- Admin surface -------------------------------------------------------------------

/** Admin toggles a state's master switch. Setting live stamps activated_at (fires the waitlist-notify trigger). */
export function useSetServiceRegionActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("service_regions")
        .update({
          is_active: isActive,
          ...(isActive ? { activated_at: new Date().toISOString() } : {}),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["service-regions"] });
      queryClient.invalidateQueries({ queryKey: ["region-waitlist", "admin"] });
    },
  });
}

/**
 * Open-waitlist demand per state for the admin page — how many people are waiting on each
 * state, so ops can see pull before flipping. Admin reads all rows via RLS (is_admin);
 * counted client-side (no group-by RPC needed at this volume).
 */
export function useOpenWaitlistCounts() {
  return useQuery({
    queryKey: ["region-waitlist", "admin", "counts"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("region_waitlist")
        .select("state")
        .is("notified_at", null);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        counts[row.state] = (counts[row.state] ?? 0) + 1;
      }
      return counts;
    },
  });
}
