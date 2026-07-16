import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import type { BookingRequestInput } from "@/lib/validation/booking";

export type Facility = Tables<"facilities">;
export type FacilityService = Tables<"facility_services">;
export type FacilityWithServices = Facility & { facility_services: FacilityService[] };
export type BookingRequest = Tables<"booking_requests">;
export type BookingRequestWithFacility = BookingRequest & {
  facilities: Pick<Facility, "name" | "type"> | null;
};

export type FacilityFilters = {
  type?: Facility["type"];
  state?: string;
  city?: string;
  area?: string;
};

function bookingRequestsKey(patientId: string) {
  return ["booking-requests", patientId];
}

/**
 * Curated, admin-maintained directory — global, no organisation_id scoping.
 * Nests each facility's active services ("what they offer") so the patient
 * sees them without a second round-trip; the `.eq("facility_services.is_active", ...)`
 * filters which embedded rows come back without turning this into an inner
 * join, so a facility with no active services still shows up (empty list).
 */
export function useFacilities(filters: FacilityFilters) {
  return useQuery({
    queryKey: ["facilities", filters],
    queryFn: async () => {
      const supabase = createClient();
      let query = supabase
        .from("facilities")
        .select("*, facility_services(*)")
        .eq("is_active", true)
        .eq("facility_services.is_active", true);
      if (filters.type) query = query.eq("type", filters.type);
      if (filters.state) query = query.ilike("state", `%${filters.state}%`);
      if (filters.city) query = query.ilike("city", `%${filters.city}%`);
      if (filters.area) query = query.ilike("area", `%${filters.area}%`);
      const { data, error } = await query.order("name", { ascending: true });
      if (error) throw error;
      return data as FacilityWithServices[];
    },
  });
}

export function useBookingRequests(patientId: string) {
  return useQuery({
    queryKey: bookingRequestsKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("booking_requests")
        .select("*, facilities(name, type)")
        .eq("profile_id", patientId)
        .order("requested_date", { ascending: false });
      if (error) throw error;
      return data as BookingRequestWithFacility[];
    },
    enabled: !!patientId,
  });
}

/**
 * booking_requests is patient-writable by design (spec §3.9 — a request,
 * not a real-time confirmed booking) — this writes through the patient's
 * own RLS-scoped session, same as vaccination_records.
 */
export function useCreateBookingRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BookingRequestInput & { patientId: string }) => {
      const supabase = createClient();
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", input.patientId)
        .single();
      if (profileError) throw profileError;
      if (!profile?.organisation_id) {
        throw new Error("This patient has no organisation on file");
      }

      const { patientId, ...rest } = input;
      const { error } = await supabase.from("booking_requests").insert({
        ...rest,
        profile_id: patientId,
        organisation_id: profile.organisation_id,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: bookingRequestsKey(variables.patientId) });
    },
  });
}
