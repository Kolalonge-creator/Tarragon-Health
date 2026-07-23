import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type ConsultSlot = Tables<"consult_availability_slots">;

export type ConsultSlotWithClinician = ConsultSlot & {
  clinician: { full_name: string | null } | null;
};

export const consultSlotKeys = {
  open: ["consult-slots", "open"] as const,
  mine: ["consult-slots", "mine"] as const,
  upcoming: (patientId: string) => ["consult-slots", "upcoming", patientId] as const,
};

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
