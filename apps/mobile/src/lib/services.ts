import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Tables, Currency } from "@tarragon/shared";
import { fromMinorUnits, CURRENCY_SYMBOL } from "@tarragon/shared";

export type ServiceProduct = Tables<"service_products">;
export type ServicePurchaseWithProduct = Tables<"service_purchases"> & {
  service_product: Pick<Tables<"service_products">, "code" | "name" | "price_kobo" | "currency" | "access_duration_days"> | null;
};

/** Mirrors apps/web/src/lib/queries/service-purchases.ts's isPurchaseCurrentlyActive verbatim. */
export function isPurchaseCurrentlyActive(purchase: Pick<Tables<"service_purchases">, "status" | "expires_at">): boolean {
  if (purchase.status !== "active") return false;
  if (!purchase.expires_at) return true;
  return new Date(purchase.expires_at).getTime() > Date.now();
}

export function formatPrice(priceKobo: number, currency: Currency): string {
  if (priceKobo === 0) return "Free";
  return `${CURRENCY_SYMBOL[currency]}${fromMinorUnits(priceKobo, currency).toLocaleString()}`;
}

export interface ServicesState {
  active: ServicePurchaseWithProduct[];
  past: ServicePurchaseWithProduct[];
  buyable: ServiceProduct[];
}

/**
 * Mirrors apps/web/src/lib/queries/service-purchases.ts's useMyServicePurchases
 * and service-products.ts's useActiveServiceProducts — both plain
 * RLS-scoped reads (service_purchases already scopes to
 * patient_id = auth.uid() OR purchaser_profile_id = auth.uid();
 * service_products is authenticated-readable), safe to call directly.
 * Buying itself is never done natively — see services-screen.tsx.
 */
export async function loadServicesState(): Promise<QueryResult<ServicesState>> {
  const [purchasesResult, productsResult] = await Promise.all([
    supabase
      .from("service_purchases")
      .select("*, service_product:service_products(code, name, price_kobo, currency, access_duration_days)")
      .order("created_at", { ascending: false }),
    supabase.from("service_products").select("*").eq("is_active", true).order("price_kobo", { ascending: true }),
  ]);
  if (purchasesResult.error) return { ok: false, error: purchasesResult.error.message };
  if (productsResult.error) return { ok: false, error: productsResult.error.message };

  const purchases = (purchasesResult.data ?? []) as ServicePurchaseWithProduct[];
  const active = purchases.filter(isPurchaseCurrentlyActive);
  const past = purchases.filter((p) => !isPurchaseCurrentlyActive(p));
  // NGN only — USD/GBP service_products exist for the diaspora sponsor-checkout
  // flow, never for a patient buying their own access (see
  // apps/web/.../subscription/subscription-manager.tsx's own comment).
  const activeProductIds = new Set(active.map((p) => p.service_product_id));
  const buyable = ((productsResult.data ?? []) as ServiceProduct[]).filter(
    (product) => product.currency === "NGN" && !activeProductIds.has(product.id)
  );

  return { ok: true, data: { active, past, buyable } };
}
