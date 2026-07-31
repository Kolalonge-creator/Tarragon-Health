import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { uploadResultAsLabPartner } from "@/lib/lab-results/actions";
import type { Tables } from "@tarragon/shared";

export type Facility = Tables<"facilities">;

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
 * Self-service branch/location management (20260730215206) — a lab partner
 * with dozens of real branches previously had no way to keep the patient-
 * facing facility picker accurate; only an admin could hand-type rows.
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
        .from("facilities")
        .select("*")
        .eq("lab_provider_id", providerId as string)
        .order("state")
        .order("city");
      if (error) throw error;
      return data as Facility[];
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
      city: string;
      area?: string;
      address?: string;
      contactPhone?: string;
      contactEmail?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("facilities").insert({
        type: "lab",
        lab_provider_id: input.providerId,
        name: input.name,
        state: input.state,
        city: input.city,
        area: input.area || null,
        address: input.address || null,
        contact_phone: input.contactPhone || null,
        contact_email: input.contactEmail || null,
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
      const { error } = await supabase.from("facilities").update({ is_active: isActive }).eq("id", id);
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
