import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export type AnnualBundleLab = {
  location_id: string;
  provider_name: string;
  location_name: string;
  town: string | null;
  state: string;
  address: string;
  contact_phone: string | null;
  opening_hours: unknown;
};

/** Towns that have an active partner lab branch in a state. Nationwide: no plan or state-rollout gate. */
export function useAnnualBundleTowns(state: string) {
  return useQuery({
    queryKey: ["annual-bundle-towns", state],
    enabled: Boolean(state),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("list_annual_bundle_towns", { p_state: state });
      if (error) throw error;
      return (data ?? []) as { town: string; lab_count: number }[];
    },
  });
}

/** Partner lab branches in a state, optionally narrowed to a town, with the address to go to. */
export function useAnnualBundleLabs(state: string, town: string) {
  return useQuery({
    queryKey: ["annual-bundle-labs", state, town],
    enabled: Boolean(state),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("list_annual_bundle_labs", {
        p_state: state,
        ...(town ? { p_town: town } : {}),
      });
      if (error) throw error;
      return (data ?? []) as AnnualBundleLab[];
    },
  });
}

/** Starts the once-a-year bundle as a self-arranged order. locationId is null for "my own lab". */
export function useStartAnnualBundle(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (locationId: string | null) => {
      const supabase = createClient();
      // the bundle belongs to the person being looked after (the Labs page may be showing a dependant), not to whoever is signed in
      const { data, error } = await supabase.rpc("start_annual_bundle", {
        p_patient: patientId,
        ...(locationId ? { p_location_id: locationId } : {}),
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-orders", patientId] });
    },
  });
}
