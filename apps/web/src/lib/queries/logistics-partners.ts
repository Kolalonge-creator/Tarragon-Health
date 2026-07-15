import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type HomeVisitProvider = Tables<"home_visit_providers">;
export type LogisticsPartner = Tables<"logistics_partners">;

/**
 * Active home_visit_providers matching a region (and, if given, a required
 * sample type) — powers both the patient-facing "is home collection
 * available here" check and the ops assignment picker. There is no
 * profiles.region/state column anywhere in this codebase (confirmed via
 * grep) — same precedent as specialist_providers matching: the assigning
 * clinician/staff manually selects a state at scheduling time, same UX as
 * /clinician/referrals/page.tsx's AssignProviderForm.
 */
export function useMatchedHomeVisitProviders(params: { region?: string; sampleType?: string }) {
  const { region, sampleType } = params;
  return useQuery({
    queryKey: ["home-visit-providers", region ?? "", sampleType ?? ""],
    queryFn: async () => {
      const supabase = createClient();
      let query = supabase.from("home_visit_providers").select("*").eq("is_active", true);
      if (region) {
        query = query.contains("regions", [region]);
      }
      if (sampleType) {
        query = query.contains("sample_types", [sampleType]);
      }
      const { data, error } = await query.order("name", { ascending: true });
      if (error) throw error;
      return data as HomeVisitProvider[];
    },
  });
}

/** Active logistics_partners matching a region — powers the delivery-availability check and the ops courier picker. */
export function useMatchedLogisticsPartners(params: { region?: string }) {
  const { region } = params;
  return useQuery({
    queryKey: ["logistics-partners", region ?? ""],
    queryFn: async () => {
      const supabase = createClient();
      let query = supabase.from("logistics_partners").select("*").eq("is_active", true);
      if (region) {
        query = query.contains("regions", [region]);
      }
      const { data, error } = await query.order("name", { ascending: true });
      if (error) throw error;
      return data as LogisticsPartner[];
    },
  });
}

/**
 * Staff assigns a home_visit_provider + scheduled time to a lab_orders row.
 * lab_orders_update RLS is org-staff-only (verified against the live
 * policy), so this is a plain client-side update — no RPC needed, unlike
 * the patient-set delivery address path below. Recording this transition is
 * also what fires private.record_home_visit_commission() server-side.
 */
export function useAssignHomeVisitProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderId,
      homeVisitProviderId,
      scheduledAt,
    }: {
      orderId: string;
      homeVisitProviderId: string;
      scheduledAt: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("lab_orders")
        .update({
          home_visit_provider_id: homeVisitProviderId,
          home_visit_scheduled_at: scheduledAt,
        })
        .eq("id", orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-orders"] });
    },
  });
}

/** Staff assigns a logistics_partner (courier) + estimated delivery window to a pharmacy_orders row, moving it to out_for_delivery. */
export function useAssignLogisticsPartner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderId,
      logisticsPartnerId,
      estimatedDeliveryAt,
      courierReference,
    }: {
      orderId: string;
      logisticsPartnerId: string;
      estimatedDeliveryAt: string;
      courierReference?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("pharmacy_orders")
        .update({
          logistics_partner_id: logisticsPartnerId,
          estimated_delivery_at: estimatedDeliveryAt,
          courier_reference: courierReference || null,
          status: "out_for_delivery",
        })
        .eq("id", orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pharmacy-orders"] });
    },
  });
}

/** Staff marks a pharmacy order delivered, recording delivery_confirmed_at. */
export function useConfirmPharmacyDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("pharmacy_orders")
        .update({
          status: "delivered",
          delivered_at: new Date().toISOString(),
          delivery_confirmed_at: new Date().toISOString(),
        })
        .eq("id", orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pharmacy-orders"] });
    },
  });
}

/**
 * Patient sets their own delivery address on their own pharmacy order.
 * pharmacy_orders_update RLS is staff-only (verified against the live
 * policy), so this goes through the narrow security definer RPC
 * public.set_pharmacy_order_delivery_address instead of a direct table
 * update — modeled on claim_employer_roster_member, re-checks
 * patient_id = auth.uid() server-side and only ever touches
 * delivery_address.
 */
export function useSetPharmacyOrderDeliveryAddress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderId,
      address,
    }: {
      orderId: string;
      address: {
        street: string;
        area: string;
        state: string;
        phone: string;
      };
    }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("set_pharmacy_order_delivery_address", {
        p_order_id: orderId,
        p_address: address,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pharmacy-orders", variables.orderId] });
      queryClient.invalidateQueries({ queryKey: ["pharmacy-orders"] });
    },
  });
}

/** All home_visit_providers (active + inactive) — admin CRUD surface only. */
export function useAllHomeVisitProviders() {
  return useQuery({
    queryKey: ["home-visit-providers", "admin", "all"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("home_visit_providers")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return data as HomeVisitProvider[];
    },
  });
}

/** All logistics_partners (active + inactive) — admin CRUD surface only. */
export function useAllLogisticsPartners() {
  return useQuery({
    queryKey: ["logistics-partners", "admin", "all"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("logistics_partners")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return data as LogisticsPartner[];
    },
  });
}

/** Admin creates a new home_visit_providers row — the mechanism that turns on the patient-facing feature for a region once activated. */
export function useCreateHomeVisitProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      regions: string[];
      sampleTypes: string[];
      homeVisitFeeKobo: number;
      isActive: boolean;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("home_visit_providers").insert({
        name: input.name,
        regions: input.regions,
        sample_types: input.sampleTypes,
        home_visit_fee_kobo: input.homeVisitFeeKobo,
        is_active: input.isActive,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["home-visit-providers"] });
    },
  });
}

/** Admin creates a new logistics_partners row — the mechanism that turns on the delivery-tracking UI for a region once activated. */
export function useCreateLogisticsPartner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      regions: string[];
      deliveryFeeKobo: number;
      estimatedDeliveryHours: number | null;
      isActive: boolean;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("logistics_partners").insert({
        name: input.name,
        regions: input.regions,
        delivery_fee_kobo: input.deliveryFeeKobo,
        estimated_delivery_hours: input.estimatedDeliveryHours,
        is_active: input.isActive,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["logistics-partners"] });
    },
  });
}

/** Admin toggles a home_visit_providers row's is_active flag. */
export function useSetHomeVisitProviderActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase.from("home_visit_providers").update({ is_active: isActive }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["home-visit-providers"] });
    },
  });
}

/** Admin toggles a logistics_partners row's is_active flag. */
export function useSetLogisticsPartnerActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase.from("logistics_partners").update({ is_active: isActive }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["logistics-partners"] });
    },
  });
}
