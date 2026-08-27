import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type PharmacyPartnerLocation = Tables<"pharmacy_partner_locations">;
export type PharmacyMedicationRow = Tables<"pharmacy_medications">;

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

/**
 * Self-service branch/location management — the pharmacist-side counterpart
 * of lab-partner.ts's useLabPartnerFacilities, targeting the new
 * pharmacy_partner_locations table (20260827203240) instead of the single
 * address on pharmacy_partners itself.
 */
export function usePharmacistOwnPartnerId() {
  return useQuery({
    queryKey: ["pharmacist-own-partner-id"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("pharmacist_own_partner_id");
      if (error) throw error;
      return data as string | null;
    },
  });
}

export function usePharmacistLocations(partnerId: string | null | undefined) {
  return useQuery({
    queryKey: ["pharmacist-locations", partnerId],
    enabled: !!partnerId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("pharmacy_partner_locations")
        .select("*")
        .eq("pharmacy_partner_id", partnerId as string)
        .order("state")
        .order("name");
      if (error) throw error;
      return data as PharmacyPartnerLocation[];
    },
  });
}

export function useCreatePharmacistLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      partnerId: string;
      name: string;
      state: string;
      address?: string;
      contactPhone?: string;
      latitude?: number;
      longitude?: number;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("pharmacy_partner_locations").insert({
        pharmacy_partner_id: input.partnerId,
        name: input.name,
        state: input.state,
        address: input.address || null,
        contact_phone: input.contactPhone || null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pharmacist-locations"] }),
  });
}

export function useSetPharmacistLocationActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("pharmacy_partner_locations")
        .update({ is_active: isActive })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pharmacist-locations"] }),
  });
}

/**
 * A pharmacist's own catalogue rows. is_active is the only column a plain
 * pharmacist may change (private.restrict_pharmacy_medication_partner_edit_to_availability,
 * 20260827203240 enforces this at the trigger level regardless of what the
 * client sends).
 */
export function usePharmacistOwnMedications(partnerId: string | null | undefined) {
  return useQuery({
    queryKey: ["pharmacist-own-medications", partnerId],
    enabled: !!partnerId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("pharmacy_medications")
        .select("*")
        .eq("pharmacy_partner_id", partnerId as string)
        .order("drug_name");
      if (error) throw error;
      return data as PharmacyMedicationRow[];
    },
  });
}

export function useSetPharmacistMedicationActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("pharmacy_medications")
        .update({ is_active: isActive })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pharmacist-own-medications"] }),
  });
}
