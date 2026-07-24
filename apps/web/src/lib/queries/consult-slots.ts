import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type ConsultSlot = Tables<"consult_availability_slots">;

export type ConsultSlotWithClinician = ConsultSlot & {
  clinician: { full_name: string | null } | null;
};

export type VideoVisitRequest = Tables<"video_visit_requests">;

export type VideoVisitRequestWithPatient = VideoVisitRequest & {
  patient: { full_name: string | null; patient_number: string | null } | null;
  slot: { slot_start: string } | null;
};

export const consultSlotKeys = {
  open: ["consult-slots", "open"] as const,
  mine: ["consult-slots", "mine"] as const,
  upcoming: (patientId: string) => ["consult-slots", "upcoming", patientId] as const,
  price: ["video-visit-price"] as const,
  myRequests: (patientId: string) => ["video-visit-requests", "mine", patientId] as const,
  orgRequests: ["video-visit-requests", "org"] as const,
};

/** The price a video visit costs the caller (org override, else platform default). */
export function useVideoVisitPrice() {
  return useQuery({
    queryKey: consultSlotKeys.price,
    queryFn: async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: profile } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", user.id)
        .single();
      const { data, error } = await supabase
        .from("video_visit_prices")
        .select("organisation_id, amount_minor, currency, is_enabled")
        .eq("is_enabled", true);
      if (error) throw error;
      const rows = data ?? [];
      // Caller's own org override wins over the platform default; other orgs'
      // overrides are ignored (the DB pin trigger applies the same rule).
      const override = rows.find(
        (r) => r.organisation_id !== null && r.organisation_id === profile?.organisation_id
      );
      return override ?? rows.find((r) => r.organisation_id === null) ?? null;
    },
  });
}

/** The patient's own video-visit requests, newest first. */
export function useMyVideoVisitRequests(patientId: string) {
  return useQuery({
    queryKey: consultSlotKeys.myRequests(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("video_visit_requests")
        .select("*, slot:consult_availability_slots!video_visit_requests_slot_id_fkey(slot_start)")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as (VideoVisitRequest & { slot: { slot_start: string } | null })[];
    },
  });
}

/** Doctor-side: paid requests waiting for acceptance (the held-payment queue). */
export function useOrgVideoVisitRequests() {
  return useQuery({
    queryKey: consultSlotKeys.orgRequests,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("video_visit_requests")
        .select(
          "*, patient:profiles!video_visit_requests_patient_id_fkey(full_name, patient_number), slot:consult_availability_slots!video_visit_requests_slot_id_fkey(slot_start)"
        )
        .eq("status", "payment_confirmed")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as VideoVisitRequestWithPatient[];
    },
  });
}

/**
 * Open, future slots in the caller's org — the patient-facing scheduling
 * grid. RLS already restricts a patient to exactly these rows; the filters
 * here just keep staff callers consistent with what a patient sees.
 */
export function useOpenConsultSlots() {
  return useQuery({
    queryKey: consultSlotKeys.open,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("consult_availability_slots")
        .select(
          "*, clinician:profiles!consult_availability_slots_clinician_profile_id_fkey(full_name)"
        )
        .is("booked_consultation_id", null)
        .gt("slot_start", new Date().toISOString())
        .order("slot_start", { ascending: true })
        .limit(30);
      if (error) throw error;
      return data as ConsultSlotWithClinician[];
    },
  });
}

/** The patient's own upcoming booked video check-ins. */
export function useUpcomingVideoVisits(patientId: string) {
  return useQuery({
    queryKey: consultSlotKeys.upcoming(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("video_consultations")
        .select("id, scheduled_at, join_url, status")
        .eq("patient_id", patientId)
        .eq("context", "general_checkin")
        .gte("scheduled_at", new Date().toISOString())
        .neq("status", "cancelled")
        .order("scheduled_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

/** Clinician-side: my published slots (booked and open), soonest first. */
export function useMyConsultSlots() {
  return useQuery({
    queryKey: consultSlotKeys.mine,
    queryFn: async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("consult_availability_slots")
        .select("*")
        .eq("clinician_profile_id", user.id)
        .gte("slot_start", new Date().toISOString())
        .order("slot_start", { ascending: true });
      if (error) throw error;
      return data as ConsultSlot[];
    },
  });
}

/** Clinician publishes an availability window as one bookable slot. */
export function usePublishConsultSlot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      organisationId,
      slotStart,
      durationMinutes,
    }: {
      organisationId: string;
      slotStart: string;
      durationMinutes: number;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const start = new Date(slotStart);
      const end = new Date(start.getTime() + durationMinutes * 60_000);
      const { error } = await supabase.from("consult_availability_slots").insert({
        organisation_id: organisationId,
        clinician_profile_id: user.id,
        slot_start: start.toISOString(),
        slot_end: end.toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: consultSlotKeys.mine });
      queryClient.invalidateQueries({ queryKey: consultSlotKeys.open });
    },
  });
}

/** Clinician removes an unbooked slot. Booked slots stay — cancelling a
 * patient's confirmed time is a conversation, not a row delete. */
export function useDeleteConsultSlot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (slotId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("consult_availability_slots")
        .delete()
        .eq("id", slotId)
        .is("booked_consultation_id", null);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: consultSlotKeys.mine });
      queryClient.invalidateQueries({ queryKey: consultSlotKeys.open });
    },
  });
}
