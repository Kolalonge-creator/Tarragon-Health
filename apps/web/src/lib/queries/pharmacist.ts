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
      queryClient.invalidateQueries({ queryKey: ["pharmacist-dispense-history"] });
    },
  });
}

export type PharmacistDispense = {
  dispense_id: string;
  patient_name: string | null;
  drug_name: string;
  quantity: string | null;
  dispensed_on: string;
};

export function usePharmacistDispenseHistory() {
  return useQuery({
    queryKey: ["pharmacist-dispense-history"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("pharmacist_dispense_history");
      if (error) throw error;
      return (data ?? []) as PharmacistDispense[];
    },
  });
}

export type PharmacistProfile = {
  name: string;
  regions: string[];
  city: string | null;
  state: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  delivery: boolean;
  license_number: string | null;
  license_expires_at: string | null;
};

export function usePharmacistProfile() {
  return useQuery({
    queryKey: ["pharmacist-profile"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("pharmacist_profile");
      if (error) throw error;
      const row = (data ?? [])[0] as PharmacistProfile | undefined;
      return row ?? null;
    },
  });
}

export function usePharmacistUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      regions: string[];
      city: string;
      state: string;
      contactPhone: string;
      contactEmail: string;
      delivery: boolean;
      licenseNumber: string;
      licenseExpiresAt: string | null;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("pharmacist_update_profile", {
        p_name: input.name,
        p_regions: input.regions,
        p_city: input.city,
        p_state: input.state,
        p_contact_phone: input.contactPhone,
        p_contact_email: input.contactEmail,
        p_delivery: input.delivery,
        p_license_number: input.licenseNumber,
        // The generated RPC arg type is non-nullable `string`, but the SQL
        // param has no NOT NULL constraint and null is a legitimate "no
        // expiry set yet" value at runtime.
        p_license_expires_at: input.licenseExpiresAt as string,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pharmacist-profile"] });
    },
  });
}
