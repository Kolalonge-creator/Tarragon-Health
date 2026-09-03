import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type ServicePurchaseWithProduct = Tables<"service_purchases"> & {
  service_product: Pick<
    Tables<"service_products">,
    "code" | "name" | "price_kobo" | "currency" | "access_duration_days"
  > | null;
};

export const MY_SERVICE_PURCHASES_QUERY_KEY = ["service-purchases", "mine"];

/** The signed-in patient's own service_purchases (any status), newest first
 * — RLS already scopes this to patient_id = auth.uid() OR
 * purchaser_profile_id = auth.uid(), so a sponsor sees what they bought for
 * someone too. Callers separate active-vs-not by status/expires_at rather
 * than a second query, since "recently expired" is useful context on the
 * same page (a pack that just lapsed is exactly what someone re-buying
 * needs to see next to the buy button). */
export function useMyServicePurchases() {
  return useQuery({
    queryKey: MY_SERVICE_PURCHASES_QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("service_purchases")
        .select(
          "*, service_product:service_products(code, name, price_kobo, currency, access_duration_days)",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ServicePurchaseWithProduct[];
    },
  });
}

export function isPurchaseCurrentlyActive(purchase: Pick<Tables<"service_purchases">, "status" | "expires_at">): boolean {
  if (purchase.status !== "active") return false;
  if (!purchase.expires_at) return true;
  return new Date(purchase.expires_at).getTime() > Date.now();
}

/** Does this patient hold a spendable single-use credit for a product right
 * now (has_available_service_purchase — active, unexpired, unredeemed)?
 * For a UI that needs to offer "use your credit" vs "buy one" without first
 * loading every purchase row. */
export function useHasAvailableServicePurchase(patientId: string, serviceProductCode: string) {
  return useQuery({
    queryKey: ["service-purchases", "has-available", patientId, serviceProductCode],
    enabled: !!patientId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("has_available_service_purchase", {
        p_patient_id: patientId,
        p_service_product_code: serviceProductCode,
      });
      if (error) throw error;
      return data as boolean;
    },
  });
}
