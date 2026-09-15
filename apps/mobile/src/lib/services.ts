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

export interface PendingPaymentIssue {
  id: string;
  serviceProductCode: string;
  serviceProductName: string;
  payableKobo: number;
  currency: Currency;
}

/**
 * Mirrors apps/web/.../patient/payment-failure-banner.tsx's
 * findStalePendingPurchase exactly (same 30-minute grace period so someone
 * mid-checkout on the provider's hosted page never sees this). A purchase
 * the patient started and never finished stays 'pending_payment'
 * indefinitely — record_service_purchase_intent always inserts a fresh row,
 * nothing else here mutates or expires it.
 */
export async function getPendingPaymentIssue(patientId: string): Promise<QueryResult<PendingPaymentIssue | null>> {
  try {
    const staleBefore = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("service_purchases")
      .select("id, payable_kobo, currency, service_product:service_products(code, name)")
      .eq("patient_id", patientId)
      .eq("status", "pending_payment")
      .lt("created_at", staleBefore)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data?.service_product?.code) return { ok: true, data: null };
    return {
      ok: true,
      data: {
        id: data.id,
        serviceProductCode: data.service_product.code,
        serviceProductName: data.service_product.name ?? "a service",
        payableKobo: data.payable_kobo ?? 0,
        currency: data.currency as Currency,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Mirrors the "Not right now" server action in apps/web/.../patient/
 * payment-failure-banner-actions.ts — same SECURITY DEFINER RPC
 * (cancel_pending_service_purchase, 20260910222854), scoped to the caller's
 * own still-pending_payment row.
 */
export async function cancelPendingServicePurchase(servicePurchaseId: string): Promise<QueryResult<void>> {
  const { error } = await supabase.rpc("cancel_pending_service_purchase", {
    p_service_purchase_id: servicePurchaseId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
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
