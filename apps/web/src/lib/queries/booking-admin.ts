import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type BookingRequest = Tables<"booking_requests">;
export type AdminBookingRequest = BookingRequest & {
  facilities: { name: string; type: string } | null;
  patient: { full_name: string | null; phone: string | null } | null;
};

const QUERY_KEY = ["admin-booking-requests"];

/**
 * Visible to any org staff (RLS: profile_id = auth.uid() or is_org_staff),
 * and since private.is_org_staff() treats 'admin' as global regardless of
 * organisation_id, the platform admin sees every request across every org.
 */
export function useAdminBookingRequests() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("booking_requests")
        .select("*, facilities(name, type), patient:profiles!booking_requests_profile_id_fkey(full_name, phone)")
        .order("requested_date", { ascending: true });
      if (error) throw error;
      return data as AdminBookingRequest[];
    },
  });
}

export function useUpdateBookingRequestStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: BookingRequest["status"] }) => {
      const supabase = createClient();
      const { error } = await supabase.from("booking_requests").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
