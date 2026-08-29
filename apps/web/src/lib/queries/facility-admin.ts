import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import type { FacilityInput, FacilityServiceInput, FacilityClinicianInput } from "@/lib/validation/facility-admin";

export type Facility = Tables<"facilities">;
export type FacilityService = Tables<"facility_services">;

const FACILITIES_KEY = ["admin-facilities"];

function facilityServicesKey(facilityId: string) {
  return ["facility-services", facilityId];
}

/** Admin management view — includes inactive facilities, unlike the patient-facing directory. */
export function useAdminFacilities() {
  return useQuery({
    queryKey: FACILITIES_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("facilities")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return data as Facility[];
    },
  });
}

export function useCreateFacility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: FacilityInput) => {
      const supabase = createClient();
      const { error } = await supabase.from("facilities").insert(input);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FACILITIES_KEY });
    },
  });
}

export function useUpdateFacility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: Partial<FacilityInput & { is_active: boolean; verified: boolean }> & { id: string }) => {
      const supabase = createClient();
      const { error } = await supabase.from("facilities").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FACILITIES_KEY });
    },
  });
}

export function useFacilityServices(facilityId: string) {
  return useQuery({
    queryKey: facilityServicesKey(facilityId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("facility_services")
        .select("*")
        .eq("facility_id", facilityId)
        .order("name", { ascending: true });
      if (error) throw error;
      return data as FacilityService[];
    },
    enabled: !!facilityId,
  });
}

export function useCreateFacilityService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: FacilityServiceInput) => {
      const supabase = createClient();
      const { error } = await supabase.from("facility_services").insert(input);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: facilityServicesKey(variables.facility_id) });
    },
  });
}

export function useUpdateFacilityService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      facility_id,
      ...patch
    }: Partial<FacilityServiceInput & { is_active: boolean }> & {
      id: string;
      facility_id: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("facility_services").update(patch).eq("id", id);
      if (error) throw error;
      return facility_id;
    },
    onSuccess: (facilityId) => {
      queryClient.invalidateQueries({ queryKey: facilityServicesKey(facilityId) });
    },
  });
}

export function useDeleteFacilityService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; facilityId: string }) => {
      const supabase = createClient();
      const { error } = await supabase.from("facility_services").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: facilityServicesKey(variables.facilityId) });
    },
  });
}

// ---------------------------------------------------------------------------
// facility_clinicians — 69.3/69.5 roster: which of Tarragon's own employed
// clinicians practise at a given facility.
// ---------------------------------------------------------------------------

export type FacilityClinician = Tables<"facility_clinicians">;

function facilityCliniciansKey(facilityId: string) {
  return ["facility-clinicians", facilityId];
}

export function useFacilityClinicians(facilityId: string) {
  return useQuery({
    queryKey: facilityCliniciansKey(facilityId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("facility_clinicians")
        .select("*, clinician:profiles!facility_clinicians_clinician_id_fkey(full_name)")
        .eq("facility_id", facilityId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as (FacilityClinician & { clinician: { full_name: string | null } | null })[];
    },
    enabled: !!facilityId,
  });
}

export function useAddFacilityClinician() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: FacilityClinicianInput & { organisationId: string }) => {
      const supabase = createClient();
      const { error } = await supabase.from("facility_clinicians").insert({
        facility_id: input.facility_id,
        clinician_id: input.clinician_id,
        organisation_id: input.organisationId,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: facilityCliniciansKey(variables.facility_id) });
    },
  });
}

export function useSetFacilityClinicianActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; facilityId: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase.from("facility_clinicians").update({ is_active: isActive }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: facilityCliniciansKey(variables.facilityId) });
    },
  });
}
