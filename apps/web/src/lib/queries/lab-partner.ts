import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { uploadResultAsLabPartner } from "@/lib/lab-results/actions";
import type { Tables } from "@tarragon/shared";

export type Facility = Tables<"facilities">;
export type LabProviderLocation = Tables<"lab_provider_locations">;

/**
 * Lab partner surface — the "lab" counterpart of pharmacist (queries/pharmacist.ts).
 * The worklist read goes through a SECURITY DEFINER RPC scoped to the caller's
 * own lab (see 20260727002742_lab_partner_surface.sql); the upload write goes
 * through a server action since it also handles the storage upload.
 */
export function useLabPartnerOrders() {
  return useQuery({
    queryKey: ["lab-partner-orders"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("lab_partner_orders");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Self-service branch/location management. Originally built (20260730215206)
 * against public.facilities, which was globally suspended
 * (20260803163135_suspend_all_facilities_and_vaccination_booking) and is now
 * dead — this now targets lab_provider_locations instead, the table that
 * actually feeds the public /coverage map via public_partner_locations()
 * (20260827203240 gave a lab_partner write access scoped to their own
 * lab_provider_id, matching the RLS shape admin already had).
 */
export function useLabPartnerOwnProviderId() {
  return useQuery({
    queryKey: ["lab-partner-own-provider-id"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("lab_partner_own_provider_id");
      if (error) throw error;
      return data as string | null;
    },
  });
}

export function useLabPartnerFacilities(providerId: string | null | undefined) {
  return useQuery({
    queryKey: ["lab-partner-facilities", providerId],
    enabled: !!providerId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("lab_provider_locations")
        .select("*")
        .eq("lab_provider_id", providerId as string)
        .order("state")
        .order("name");
      if (error) throw error;
      return data as LabProviderLocation[];
    },
  });
}

export function useCreateLabPartnerFacility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      providerId: string;
      name: string;
      state: string;
      address: string;
      contactPhone?: string;
      latitude?: number;
      longitude?: number;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("lab_provider_locations").insert({
        lab_provider_id: input.providerId,
        name: input.name,
        state: input.state,
        address: input.address,
        contact_phone: input.contactPhone || null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lab-partner-facilities"] }),
  });
}

export function useSetLabPartnerFacilityActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("lab_provider_locations")
        .update({ is_active: isActive })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lab-partner-facilities"] }),
  });
}

export type LabTurnaroundSelfStats = {
  orders_resulted: number;
  avg_turnaround_hours: number | null;
  median_turnaround_hours: number | null;
  pct_over_72h: number | null;
};

/** The transparency this critique asked for turned outward on the platform itself: a lab partner can see its own turnaround numbers, not just be measured silently. */
export function useLabPartnerTurnaroundStats() {
  return useQuery({
    queryKey: ["lab-partner-turnaround-stats"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("lab_partner_turnaround_stats");
      if (error) throw error;
      const row = (data ?? [])[0] as LabTurnaroundSelfStats | undefined;
      return row ?? { orders_resulted: 0, avg_turnaround_hours: null, median_turnaround_hours: null, pct_over_72h: null };
    },
  });
}

export function useLabPartnerUploadResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderId,
      file,
      note,
    }: {
      orderId: string;
      file: File;
      note?: string;
    }) => {
      const formData = new FormData();
      formData.set("order_id", orderId);
      formData.set("file", file);
      if (note?.trim()) formData.set("note", note.trim());
      const result = await uploadResultAsLabPartner(formData);
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-partner-orders"] });
    },
  });
}
