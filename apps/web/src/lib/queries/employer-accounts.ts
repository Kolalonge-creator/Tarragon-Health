import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type EmployerAccount = Tables<"employer_accounts">;
export type EmployerLocation = Tables<"employer_locations">;
export type EmployerDepartment = Tables<"employer_departments">;
export type CorporateContract = Tables<"corporate_contracts">;

function accountKey(organisationId: string) {
  return ["employer-account", organisationId];
}
function locationsKey(organisationId: string) {
  return ["employer-locations", organisationId];
}
function departmentsKey(organisationId: string) {
  return ["employer-departments", organisationId];
}
function contractKey(organisationId: string) {
  return ["employer-contract", organisationId];
}

/** Module 26 §26.2/§26.3 — the employer's own account record: legal entity,
 * verification, onboarding step. Readable by the employer itself and by
 * Tarragon staff of the org (see employer_accounts_select). */
export function useEmployerAccount(organisationId: string) {
  return useQuery({
    queryKey: accountKey(organisationId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("employer_accounts")
        .select("*")
        .eq("organisation_id", organisationId)
        .maybeSingle();
      if (error) throw error;
      return data as EmployerAccount | null;
    },
    enabled: !!organisationId,
  });
}

/** The employer's own commercial terms — read-only for the employer (see
 * corporate_contracts_select_institution_admin, added alongside
 * employer_accounts in part 1/6). Written only by Tarragon operations. */
export function useCorporateContract(organisationId: string) {
  return useQuery({
    queryKey: contractKey(organisationId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("corporate_contracts")
        .select("*")
        .eq("organisation_id", organisationId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as CorporateContract | null;
    },
    enabled: !!organisationId,
  });
}

export function useEmployerLocations(organisationId: string) {
  return useQuery({
    queryKey: locationsKey(organisationId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("employer_locations")
        .select("*")
        .eq("organisation_id", organisationId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as EmployerLocation[];
    },
    enabled: !!organisationId,
  });
}

export function useAddEmployerLocation(organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; city?: string; state?: string }) => {
      const supabase = createClient();
      const { error } = await supabase.from("employer_locations").insert({
        organisation_id: organisationId,
        name: input.name,
        city: input.city || null,
        state: input.state || null,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: locationsKey(organisationId) }),
  });
}

export function useEmployerDepartments(organisationId: string) {
  return useQuery({
    queryKey: departmentsKey(organisationId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("employer_departments")
        .select("*")
        .eq("organisation_id", organisationId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as EmployerDepartment[];
    },
    enabled: !!organisationId,
  });
}

export function useAddEmployerDepartment(organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; location_id?: string | null }) => {
      const supabase = createClient();
      const { error } = await supabase.from("employer_departments").insert({
        organisation_id: organisationId,
        name: input.name,
        location_id: input.location_id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: departmentsKey(organisationId) }),
  });
}

/** §26.4 organisation code — self-serve join key. Rotating invalidates the
 * old one immediately (public.employer_rotate_join_code). */
export function useRotateJoinCode(organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("employer_rotate_join_code", {
        p_organisation_id: organisationId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKey(organisationId) }),
  });
}

/** Patient-facing: join an employer programme with its organisation code. */
export function useJoinWithEmployerCode() {
  return useMutation({
    mutationFn: async (code: string) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("employer_join_with_code", { p_code: code });
      if (error) throw error;
      return data as string;
    },
  });
}
