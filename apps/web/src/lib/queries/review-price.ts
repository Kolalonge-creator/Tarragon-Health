import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/**
 * What a review actually costs THIS patient.
 *
 * Everything about the shape of this is decided in the database, not here.
 * `public.price_review_for_patient` computes the number from the tests that
 * particular patient is being given (their sex, their age, what is already on
 * their record, what an active chronic pathway already covers) and — for
 * anyone who is not org staff — strips the per-test prices out of its own
 * response before returning it.
 *
 * So the "one review, one price, never a per-test price" promise is not a
 * rule this file has to remember to keep: a patient's session literally
 * cannot receive a per-line price to render. `lines` here carries names only,
 * which is what the "see everything included" disclosure shows.
 */
export type ReviewPriceLine = {
  code: string;
  name: string;
};

export type ReviewPrice = {
  ok: boolean;
  error?: string;
  bundle_code: string;
  bundle_name: string;
  currency: "NGN";
  /** The one number. Kobo, like every amount on the platform. */
  total_kobo: number;
  /** Indicative catalogue figure. Not what this patient pays — that is total_kobo. */
  headline_price_kobo: number;
  lines: ReviewPriceLine[];
  delivered_count?: number;
  /**
   * False when a review contains nothing for this patient, or contains a test
   * with no price on file. Never render a price when this is false.
   */
  priceable: boolean;
};

/**
 * Disabled until both a patient and a bundle are known, so a half-rendered
 * booking card never quotes a price for nobody.
 */
export function useReviewPrice(
  patientId: string | null | undefined,
  bundleCode: string | null | undefined,
) {
  return useQuery({
    queryKey: ["review-price", patientId ?? "", bundleCode ?? ""],
    enabled: Boolean(patientId) && Boolean(bundleCode),
    queryFn: async (): Promise<ReviewPrice | null> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("price_review_for_patient", {
        p_patient_id: patientId as string,
        p_bundle_code: bundleCode as string,
      });
      if (error) throw error;
      if (!data || typeof data !== "object") return null;
      return data as unknown as ReviewPrice;
    },
  });
}
