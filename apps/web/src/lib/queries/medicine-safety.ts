import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  parseSupporterDoses,
  validateRuleSet,
  type BrandMapEntry,
  type IngredientRule,
  type SupporterDosesView,
} from "@tarragon/medicines";
import { createClient } from "@/lib/supabase/client";

/**
 * S08y client reads. Every one of these FAILS LOUD (the query errors) rather than answering "nothing found": the add form tells
 * "closed" from "could not find out" apart, and a failure must never read as a pass. None of them writes a medicine.
 */

/** Published brand mappings (active, with a named reviewer). The database only sends a patient those rows. */
export function useBrandMap(enabled = true) {
  return useQuery({
    queryKey: ["medicine-brand-map"],
    enabled,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<BrandMapEntry[]> => {
      // The database door sends published rows only, without who entered or reviewed them (staff ids are not a patient's business).
      const { data, error } = await createClient().rpc("published_medicine_brands");
      if (error) throw error;
      // The API returns at most 1000 rows. A full page may be a cut one, which would silently drop brands: fail loudly instead.
      if ((data ?? []).length >= 1000) throw new Error("the brand list reached the page limit");
      return (data ?? []).map((r) => ({
        id: r.id,
        brandName: r.brand_name,
        ingredients: r.ingredients,
        sourceCitation: r.source_citation,
        // A named reviewer exists for every published row; the name stands in for the id the patient is not shown.
        reviewedBy: r.reviewer_name,
        reviewerName: r.reviewer_name,
        reviewedAt: r.reviewed_at,
        isActive: true,
      }));
    },
  });
}

/** Is the same-ingredient warning switched on for the signed-in person? */
export function useDuplicateIngredientCheckOpen(enabled = true) {
  return useQuery({
    queryKey: ["go-live-guard", "medicine_duplicate_ingredient_check"],
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await createClient().rpc("go_live_guard_is_open", { p_key: "medicine_duplicate_ingredient_check" });
      if (error) throw error;
      return data === true;
    },
  });
}

/**
 * The active SIGNED interaction rules, or an empty list when the guard is closed or no signed non-empty set exists. A malformed
 * answer THROWS (it is never read as "no rules"), so the form can say the check could not run.
 */
export function useInteractionRules(enabled = true) {
  return useQuery({
    queryKey: ["medicine-interaction-rules"],
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<IngredientRule[]> => {
      const { data, error } = await createClient().rpc("active_medicine_interaction_rules");
      if (error) throw error;
      const doc = data as { status?: string; rules?: unknown } | null;
      if (doc?.status === "closed") return [];
      if (doc?.status !== "ok") throw new Error("unexpected answer from the interaction rules door");
      const checked = validateRuleSet({ rules: doc.rules });
      if (!checked.ok) throw new Error("the interaction rules did not pass the shape check");
      return checked.rules;
    },
  });
}

const packNumbersKey = (patientId: string) => ["pack-numbers", patientId];

/** NAFDAC numbers the person noted, by medicine id. */
export function usePackNumbers(patientId: string) {
  return useQuery({
    queryKey: packNumbersKey(patientId),
    enabled: Boolean(patientId),
    retry: false,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await createClient().from("medication_pack_numbers").select("medication_id, nafdac_number").eq("patient_id", patientId);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((r) => [r.medication_id, r.nafdac_number]));
    },
  });
}

/** Store (or, with a blank, clear) the NAFDAC number noted from a pack. Store only. */
export function useSetNafdacNumber(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { medicationId: string; number: string }) => {
      const { error } = await createClient().rpc("set_medication_nafdac_number", { p_medication: input.medicationId, p_number: input.number });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: packNumbersKey(patientId) }),
  });
}

/** Is the S28 pharmacy collection flow open? Offered as a link on a low supply only when it is. */
export function usePharmacyCollectionOpen() {
  return useQuery({
    queryKey: ["go-live-guard", "prescribing_enabled"],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await createClient().rpc("go_live_guard_is_open", { p_key: "prescribing_enabled" });
      if (error) throw error;
      return data === true;
    },
  });
}

/** A supporter's read-only "today's doses" for one person. The database refuses unless that person shared their medicines. */
export function useSupporterTodaysDoses(patientId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["supporter-todays-doses", patientId],
    enabled: enabled && Boolean(patientId),
    retry: false,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<SupporterDosesView> => {
      const { data, error } = await createClient().rpc("supporter_todays_doses", { p_patient: patientId });
      if (error) throw error;
      return parseSupporterDoses(data);
    },
  });
}
