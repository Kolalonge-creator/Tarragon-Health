import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CatalogueEntry } from "@tarragon/medicines";
import { createClient } from "@/lib/supabase/client";

/**
 * The medicine catalogue for search-as-you-type (spec 8.2). Small enough to load once and rank in the browser, so a slow
 * connection never blocks adding a medicine. A failure is an empty list: typing a name by hand always works.
 */
export function useMedicineCatalogue() {
  return useQuery({
    queryKey: ["medicine-catalogue"],
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<CatalogueEntry[]> => {
      const { data, error } = await createClient()
        .from("medicine_catalogue")
        .select("id, brand_name, generic_name, strength, form, nafdac_number, is_verified")
        .eq("is_active", true)
        .order("generic_name")
        .limit(1000);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        brandName: r.brand_name,
        genericName: r.generic_name,
        strength: r.strength,
        form: r.form,
        nafdacNumber: r.nafdac_number,
        isVerified: r.is_verified,
      }));
    },
  });
}

/**
 * Is the interaction and duplication check open for the signed-in person? Reads the go-live guard (INV-14). Fail closed: any
 * error reads as "not open", so the add form behaves exactly as it did before S53.
 */
export function useInteractionCheckOpen() {
  return useQuery({
    queryKey: ["go-live-guard", "interaction_check_enabled"],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await createClient().rpc("go_live_guard_is_open", { p_key: "interaction_check_enabled" });
      if (error) return false;
      return data === true;
    },
  });
}

/** A side-effect note for the next consultation (8.7). Never edits a medicine, a dose or a schedule. */
export function useAddSideEffectNote(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { medicationId: string; note: string }) => {
      const { error } = await createClient()
        .from("medication_side_effect_notes")
        .insert({
          medication_id: input.medicationId,
          note: input.note.trim(),
        });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["side-effect-notes", patientId] }),
  });
}
