import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables, Enums } from "@tarragon/shared";
import type { CommissionRateValue } from "@/components/admin/commission-rate-editor";

export type LabProvider = Tables<"lab_providers">;
export type PharmacyPartner = Tables<"pharmacy_partners">;
export type SpecialistProvider = Tables<"specialist_providers">;
export type SpecialistType = Enums<"specialist_type">;
export type PanelBundle = Tables<"panel_bundles">;
export type PharmacyMedication = Tables<"pharmacy_medications"> & { pharmacy_partner_name: string | null };

function commissionRateUpdate(value: CommissionRateValue) {
  return {
    commission_rate_type: value.commissionRateType,
    commission_rate: value.commissionRate,
    commission_flat_kobo: value.commissionFlatKobo,
  };
}

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
// Lab tests & bundles — the catalogue rows record_lab_commission() actually
// reads (panel_bundles.commission_rate), not lab_providers itself.
// ---------------------------------------------------------------------------
export function useAllPanelBundles() {
  return useQuery({
    queryKey: ["panel-bundles", "admin", "all"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.from("panel_bundles").select("*").order("name");
      if (error) throw error;
      return data as PanelBundle[];
    },
  });
}

export function useUpdatePanelBundleCommission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...value }: { id: string } & CommissionRateValue) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("panel_bundles")
        .update(commissionRateUpdate(value))
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["panel-bundles"] }),
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
// Pharmacy medications — the catalogue rows record_pharmacy_commission()
// actually reads (pharmacy_medications.commission_rate per item).
// ---------------------------------------------------------------------------
export function useAllPharmacyMedications() {
  return useQuery({
    queryKey: ["pharmacy-medications", "admin", "all"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("pharmacy_medications")
        .select("*, pharmacy_partners(name)")
        .order("drug_name");
      if (error) throw error;
      return (data ?? []).map((row) => {
        const { pharmacy_partners, ...rest } = row as typeof row & {
          pharmacy_partners: { name: string } | null;
        };
        return { ...rest, pharmacy_partner_name: pharmacy_partners?.name ?? null };
      }) as PharmacyMedication[];
    },
  });
}

export function useUpdatePharmacyMedicationCommission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...value }: { id: string } & CommissionRateValue) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("pharmacy_medications")
        .update(commissionRateUpdate(value))
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pharmacy-medications"] }),
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
    mutationFn: async (
      input: {
        name: string;
        specialistType: SpecialistType;
        state: string | null;
        consultationFeeKobo: number;
        supportsTelemedicine: boolean;
        isActive: boolean;
      } & CommissionRateValue
    ) => {
      const supabase = createClient();
      const { error } = await supabase.from("specialist_providers").insert({
        name: input.name,
        specialist_type: input.specialistType,
        state: input.state,
        consultation_fee_kobo: input.consultationFeeKobo,
        supports_telemedicine: input.supportsTelemedicine,
        is_active: input.isActive,
        ...commissionRateUpdate(input),
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

export function useUpdateSpecialistProviderCommission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...value }: { id: string } & CommissionRateValue) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("specialist_providers")
        .update(commissionRateUpdate(value))
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["specialist-providers"] }),
  });
}
