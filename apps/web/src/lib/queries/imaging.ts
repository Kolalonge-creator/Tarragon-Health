import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type ImagingStudy = Tables<"imaging_studies">;
export type ImagingProvider = Tables<"imaging_providers">;
export type ImagingOrder = Tables<"imaging_orders">;
export type ImagingReport = Tables<"imaging_reports">;

/** Active imaging_studies — the bookable catalogue unit (spec §59.3). */
export function useImagingCatalogue(providerId?: string) {
  return useQuery({
    queryKey: ["imaging-catalogue", providerId ?? "all"],
    queryFn: async () => {
      const supabase = createClient();
      let query = supabase.from("imaging_studies").select("*").eq("is_active", true);
      if (providerId) query = query.eq("provider_id", providerId);
      const { data, error } = await query.order("name", { ascending: true });
      if (error) throw error;
      return data as ImagingStudy[];
    },
  });
}

/** Active imaging_providers — the Diagnostic Organisation catalogue (§59.2). */
export function useImagingProviders() {
  return useQuery({
    queryKey: ["imaging-providers"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("imaging_providers")
        .select("*")
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return data as ImagingProvider[];
    },
  });
}

/** A patient's own imaging orders (RLS-scoped — patient sees their own, org
 * staff see any of their org's patients'). */
export function useImagingOrders(patientId: string) {
  return useQuery({
    queryKey: ["imaging-orders", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("imaging_orders")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ImagingOrder[];
    },
    enabled: !!patientId,
  });
}

/** A patient's filed imaging reports (RLS-scoped, same posture as orders). */
export function useImagingReports(patientId: string) {
  return useQuery({
    queryKey: ["imaging-reports", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("imaging_reports")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ImagingReport[];
    },
    enabled: !!patientId,
  });
}
