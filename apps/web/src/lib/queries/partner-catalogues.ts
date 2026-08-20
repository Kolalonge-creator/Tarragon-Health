import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables, Enums } from "@tarragon/shared";
import type { CommissionRateValue } from "@/components/admin/commission-rate-editor";
import type { PartnerLicenseValues } from "@/components/admin/partner-license-fields";

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

/** Fixes the real gap where the 4 seeded real-name partners had .example placeholder contacts forever. */
export function useUpdateLabProviderContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      contactEmail,
      contactPhone,
    }: {
      id: string;
      contactEmail: string | null;
      contactPhone: string | null;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("lab_providers")
        .update({ contact_email: contactEmail, contact_phone: contactPhone })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lab-providers"] }),
  });
}

export type LabTurnaroundStats = {
  provider_id: string;
  provider_name: string;
  orders_resulted: number;
  avg_turnaround_hours: number | null;
  median_turnaround_hours: number | null;
  pct_over_72h: number | null;
  suppressed: boolean;
};

/** Admin/RBAC-delegate scorecard across every lab provider (last 90 days). */
export function useLabProviderTurnaroundStats() {
  return useQuery({
    queryKey: ["lab-providers", "turnaround-stats", "admin"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("lab_provider_turnaround_stats");
      if (error) throw error;
      return (data ?? []) as LabTurnaroundStats[];
    },
  });
}

export type Facility = Tables<"facilities">;

/** Admin view of one lab's branches/addresses — admin already holds RLS write on facilities (is_admin() OR partners.facilities.manage), this just scopes the read to one lab. */
export function useLabFacilities(labProviderId: string) {
  return useQuery({
    queryKey: ["lab-facilities", "admin", labProviderId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("facilities")
        .select("*")
        .eq("lab_provider_id", labProviderId)
        .order("state")
        .order("city");
      if (error) throw error;
      return data as Facility[];
    },
  });
}

export function useCreateLabFacility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      labProviderId: string;
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
        lab_provider_id: input.labProviderId,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lab-facilities"] }),
  });
}

export function useSetLabFacilityActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase.from("facilities").update({ is_active: isActive }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lab-facilities"] }),
  });
}

export type LabPartnerLoginRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  lab_provider_id: string | null;
};

/** Link (or unlink, pass null) an existing lab_partner-role login to a lab_providers row. */
export function useLinkLabPartner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ profileId, labProviderId }: { profileId: string; labProviderId: string | null }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("admin_link_lab_partner", {
        p_profile_id: profileId,
        // Generated arg type is non-nullable (no SQL DEFAULT), but the
        // function explicitly treats a null p_lab_provider_id as "unlink".
        p_lab_provider_id: labProviderId as string,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lab-partner-logins"] }),
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

export function useUpdateLabProviderLicense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...license }: { id: string } & PartnerLicenseValues) => {
      const supabase = createClient();
      const { error } = await supabase.from("lab_providers").update(license).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lab-providers"] }),
  });
}

export function useUpdatePharmacyPartnerLicense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...license }: { id: string } & PartnerLicenseValues) => {
      const supabase = createClient();
      const { error } = await supabase.from("pharmacy_partners").update(license).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pharmacy-partners"] }),
  });
}

export function useUpdateSpecialistProviderLicense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...license }: { id: string } & PartnerLicenseValues) => {
      const supabase = createClient();
      const { error } = await supabase.from("specialist_providers").update(license).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["specialist-providers"] }),
  });
}
