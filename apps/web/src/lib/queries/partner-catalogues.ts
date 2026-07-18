import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables, Enums } from "@tarragon/shared";

export type LabProvider = Tables<"lab_providers">;
export type PharmacyPartner = Tables<"pharmacy_partners">;
export type SpecialistProvider = Tables<"specialist_providers">;
export type SpecialistType = Enums<"specialist_type">;

// ---------------------------------------------------------------------------
// Labs
// ---------------------------------------------------------------------------
export function useAllLabProviders() {
  return useQuery({
    queryKey: ["lab-providers", "admin", "all"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.from("lab_providers").select("*").order("name");
      if (error) throw error;
      return data as LabProvider[];
    },
  });
}

export function useCreateLabProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; regions: string[]; homeCollection: boolean; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase.from("lab_providers").insert({
        name: input.name,
        regions: input.regions,
        home_collection: input.homeCollection,
        is_active: input.isActive,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lab-providers"] }),
  });
}

export function useSetLabProviderActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase.from("lab_providers").update({ is_active: isActive }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lab-providers"] }),
  });
}

// ---------------------------------------------------------------------------
// Pharmacies
// ---------------------------------------------------------------------------
export function useAllPharmacyPartners() {
  return useQuery({
    queryKey: ["pharmacy-partners", "admin", "all"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.from("pharmacy_partners").select("*").order("name");
      if (error) throw error;
      return data as PharmacyPartner[];
    },
  });
}

export function useCreatePharmacyPartner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      regions: string[];
      state: string | null;
      city: string | null;
      contactPhone: string | null;
      contactEmail: string | null;
      delivery: boolean;
      isActive: boolean;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("pharmacy_partners").insert({
        name: input.name,
        regions: input.regions,
        state: input.state,
        city: input.city,
        contact_phone: input.contactPhone,
        contact_email: input.contactEmail,
        delivery: input.delivery,
        is_active: input.isActive,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pharmacy-partners"] }),
  });
}

export function useSetPharmacyPartnerActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase.from("pharmacy_partners").update({ is_active: isActive }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pharmacy-partners"] }),
  });
}

// ---------------------------------------------------------------------------
// Specialists
// ---------------------------------------------------------------------------
export function useAllSpecialistProviders() {
  return useQuery({
    queryKey: ["specialist-providers", "admin", "all"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.from("specialist_providers").select("*").order("name");
      if (error) throw error;
      return data as SpecialistProvider[];
    },
  });
}

export function useCreateSpecialistProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      specialistType: SpecialistType;
      state: string | null;
      consultationFeeKobo: number;
      supportsTelemedicine: boolean;
      isActive: boolean;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("specialist_providers").insert({
        name: input.name,
        specialist_type: input.specialistType,
        state: input.state,
        consultation_fee_kobo: input.consultationFeeKobo,
        supports_telemedicine: input.supportsTelemedicine,
        is_active: input.isActive,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["specialist-providers"] }),
  });
}

export function useSetSpecialistProviderActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase.from("specialist_providers").update({ is_active: isActive }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["specialist-providers"] }),
  });
}
