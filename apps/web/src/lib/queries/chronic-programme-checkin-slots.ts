import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export type DoctorCheckinSlot = {
  clinician_id: string;
  clinician_name: string;
  slot_start: string;
  slot_end: string;
  location: string | null;
};

/** Pooled doctor-checkin slot search for the 12-week programme's
 * doctor-supported track — wraps public.get_available_doctor_checkin_slots,
 * which itself wraps the shared get_available_appointment_slots (reused
 * unchanged) filtered to real doctors (excludes care_coordinator by name).
 * No clinician is ever picked in advance — whoever has capacity that week
 * takes the call, per the "your care team, not your doctor" rule. */
export function useAvailableDoctorCheckinSlots(params: {
  organisationId: string;
  from?: string;
  to?: string;
  enabled?: boolean;
}) {
  const { enabled = true, organisationId, from, to } = params;
  return useQuery({
    queryKey: ["chronic-programme", "doctor-checkin-slots", organisationId, from, to],
    enabled: enabled && !!organisationId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_available_doctor_checkin_slots", {
        p_organisation_id: organisationId,
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return (data ?? []) as DoctorCheckinSlot[];
    },
  });
}
