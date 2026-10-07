import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { isNotOpen, type DirectoryArgs, type DirectoryRow, type MyBooking } from "@/lib/directory/model";

export const directoryKeys = {
  search: (args: DirectoryArgs) => ["directory", "search", args] as const,
  bookings: ["directory", "bookings"] as const,
  licence: (profileId: string) => ["directory", "licence", profileId] as const,
};

export class DirectoryNotOpenError extends Error {
  constructor() {
    super("directory_not_open");
    this.name = "DirectoryNotOpenError";
  }
}

/** The caller's place is sent as an argument and never stored: nothing here writes it anywhere. */
export function useDirectorySearch(args: DirectoryArgs, enabled: boolean) {
  return useQuery({
    queryKey: directoryKeys.search(args),
    enabled,
    queryFn: async (): Promise<DirectoryRow[]> => {
      const { data, error } = await createClient().rpc("directory_search", args);
      if (isNotOpen(error)) throw new DirectoryNotOpenError();
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useReportListing() {
  return useMutation({
    mutationFn: async (input: { listingTable: string; listingId: string; field: string; detail: string }) => {
      const { error } = await createClient().rpc("report_directory_listing", {
        p_listing_table: input.listingTable,
        p_listing_id: input.listingId,
        p_field: input.field,
        p_detail: input.detail.trim() || undefined,
      });
      if (error) throw new Error(error.message);
    },
  });
}

export function useRequestBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { facilityId: string; slotIso: string; service: string }) => {
      const { error } = await createClient().rpc("create_facility_booking", {
        p_facility: input.facilityId,
        p_slot: input.slotIso,
        p_service: input.service.trim() || undefined,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: directoryKeys.bookings }),
  });
}

export function useMyBookings() {
  return useQuery({
    queryKey: directoryKeys.bookings,
    queryFn: async (): Promise<MyBooking[]> => {
      const { data, error } = await createClient().rpc("my_facility_bookings");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useRespondBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { bookingId: string; response: "coming" | "cancelling" }) => {
      const { error } = await createClient().rpc("respond_facility_booking", { p_booking: input.bookingId, p_response: input.response });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: directoryKeys.bookings }),
  });
}

export function useSubmitRating() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { facilityId: string; bookingId: string; rating: number; comment: string }) => {
      const { error } = await createClient().rpc("submit_facility_rating", {
        p_facility: input.facilityId,
        p_booking: input.bookingId,
        p_rating: input.rating,
        p_comment: input.comment.trim() || undefined,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: directoryKeys.bookings }),
  });
}

/** Null-gated: a clinician whose licence has not been checked returns no row, and the screen shows nothing at all. */
export function useClinicianLicence(profileId: string | null | undefined) {
  return useQuery({
    queryKey: directoryKeys.licence(profileId ?? "none"),
    enabled: Boolean(profileId),
    queryFn: async () => {
      const { data, error } = await createClient().rpc("clinician_licence_public", { p_profile: profileId as string });
      if (error) throw new Error(error.message);
      return data?.[0] ?? null;
    },
  });
}
