import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/** The four one-off cancer-screening bundles from the 2026-09-03 catalogue
 * rebuild — service_products purchases that redeem into screening_schedules
 * on activation (redeem_cancer_screening_purchase). See the migration for
 * why the "30 and over" / "Women 45+" HPV co-test component schedules the
 * existing `cervical_smear` cadence rather than a separately-priced one. */
export const CANCER_SCREENING_PRODUCT_CODES = [
  "cancer_screen_cervical_under30",
  "cancer_screen_cervical_30plus",
  "cancer_screen_women_45plus",
  "cancer_screen_men_45plus",
] as const;

export type CancerScreeningProductCode = (typeof CANCER_SCREENING_PRODUCT_CODES)[number];

/** Spends a just-purchased credit and schedules the screening(s) it covers.
 * Idempotent server-side (has_available_service_purchase gates it), so this
 * is safe to call opportunistically whenever the card notices an available,
 * unredeemed credit rather than only right after checkout. */
export function useRedeemCancerScreeningPurchase(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (serviceProductCode: CancerScreeningProductCode) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("redeem_cancer_screening_purchase", {
        p_patient_id: patientId,
        p_product_code: serviceProductCode,
      });
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["service-purchases"] });
      queryClient.invalidateQueries({ queryKey: ["screening-schedules"] });
    },
  });
}
