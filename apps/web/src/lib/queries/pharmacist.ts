import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/**
 * Pharmacist surface (Phase 8b). Every call goes through a SECURITY DEFINER
 * RPC that scopes to the caller's own pharmacy — the client can only ever see
 * its own orders' patients (see 20260716178000_pharmacist_surface.sql).
 */
export function usePharmacistOrders() {
  return useQuery({
    queryKey: ["pharmacist-orders"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("pharmacist_orders");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePharmacistOrderAllergies(orderId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["pharmacist-order-allergies", orderId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("pharmacist_order_allergies", {
        p_order_id: orderId,
      });
      if (error) throw error;
      return data ?? [];
    },
    enabled: enabled && !!orderId,
  });
}

export function usePharmacistOrderMedications(orderId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["pharmacist-order-medications", orderId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("pharmacist_order_medications", {
        p_order_id: orderId,
      });
      if (error) throw error;
      return data ?? [];
    },
    enabled: enabled && !!orderId,
  });
}

export function usePharmacistRecordDispense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderId,
      drugName,
      quantity,
      dispensedOn,
    }: {
      orderId: string;
      drugName: string;
      quantity: string;
      dispensedOn: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("pharmacist_record_dispense", {
        p_order_id: orderId,
        p_drug_name: drugName,
        p_quantity: quantity,
        p_dispensed_on: dispensedOn,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pharmacist-orders"] });
    },
  });
}
