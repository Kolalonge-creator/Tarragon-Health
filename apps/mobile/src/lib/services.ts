import { supabase } from "./supabase";
import { fromMinorUnits, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";
import type { QueryResult } from "./medications";

/**
 * "My services" — the pay-per-service billing screen. Every read here is a
 * plain RLS-scoped select, mirroring apps/web/src/lib/queries/
 * {service-products,service-purchases}.ts exactly; only the actual purchase
 * (api.ts's postServicesCheckout) needs a server round-trip, since that one
 * touches the Paystack secret key. See docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md's
 * 2026-09-02 pay-per-service cutover — there is no "current plan" concept
 * any more, just a set of currently-active one-off purchases.
 */
export interface ServiceProduct {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_kobo: number;
  currency: string;
  access_duration_days: number | null;
}

/** NGN only, matching subscription-manager.tsx's own filter — USD/GBP
 * service_products exist only for the diaspora sponsor-checkout flow, never
 * for a patient buying their own access. */
export async function loadActiveServiceProducts(): Promise<QueryResult<ServiceProduct[]>> {
  const { data, error } = await supabase
    .from("service_products")
    .select("id, code, name, description, price_kobo, currency, access_duration_days")
    .eq("is_active", true)
    .eq("currency", "NGN")
    .order("price_kobo", { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data ?? [] };
}

export interface ServicePurchase {
  id: string;
  service_product_id: string;
  status: string;
  currency: string;
  expires_at: string | null;
  created_at: string;
  service_product_name: string | null;
}

/** The signed-in patient's own service_purchases, any status, newest
 * first — RLS already scopes this to patient_id = auth.uid() OR
 * purchaser_profile_id = auth.uid(). */
export async function loadMyServicePurchases(): Promise<QueryResult<ServicePurchase[]>> {
  const { data, error } = await supabase
    .from("service_purchases")
    .select("id, service_product_id, status, currency, expires_at, created_at, service_product:service_products(name)")
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      id: row.id,
      service_product_id: row.service_product_id,
      status: row.status,
      currency: row.currency,
      expires_at: row.expires_at,
      created_at: row.created_at,
      service_product_name: row.service_product?.name ?? null,
    })),
  };
}

export function isPurchaseCurrentlyActive(purchase: Pick<ServicePurchase, "status" | "expires_at">): boolean {
  if (purchase.status !== "active") return false;
  if (!purchase.expires_at) return true;
  return new Date(purchase.expires_at).getTime() > Date.now();
}

export function formatServicePrice(priceKobo: number, currency: string): string {
  if (priceKobo === 0) return "Free";
  const symbol = CURRENCY_SYMBOL[currency as Currency] ?? currency;
  return `${symbol}${fromMinorUnits(priceKobo, currency as Currency).toLocaleString()}`;
}
