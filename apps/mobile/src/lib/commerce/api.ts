import type { QueryResult } from "../medications";
import { supabase } from "../supabase";
import { parseCatalogue, parseCheckout, parseMembership, parseOrders, parseVerify, type CatalogueItem, type MembershipState, type OrderRow } from "./parse";

/** The patient side of S25 checkout. Only the item code and a retry key are ever sent; the price comes from the database. */
export type CheckoutResult =
  | { ok: true; reference: string; checkoutUrl: string }
  | { ok: false; code: string };

export async function loadCatalogue(): Promise<QueryResult<CatalogueItem[]>> {
  const { data, error } = await supabase.rpc("catalogue");
  return error ? { ok: false, error: error.message } : { ok: true, data: parseCatalogue(data) };
}
export async function loadMyOrders(): Promise<QueryResult<OrderRow[]>> {
  const { data, error } = await supabase.rpc("my_orders");
  return error ? { ok: false, error: error.message } : { ok: true, data: parseOrders(data) };
}
export async function loadMembership(): Promise<QueryResult<MembershipState>> {
  const { data, error } = await supabase.rpc("my_membership");
  return error ? { ok: false, error: error.message } : { ok: true, data: parseMembership(data) };
}

async function errorCodeOf(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx && typeof (ctx as Response).clone === "function") {
    try {
      const body: unknown = await (ctx as Response).clone().json();
      const code = (body as { error?: unknown } | null)?.error;
      if (typeof code === "string") return code;
    } catch {
      // not JSON: generic code
    }
  }
  return "unknown";
}

export async function startCheckout(code: string, clientKey: string): Promise<CheckoutResult> {
  const { data, error } = await supabase.functions.invoke("order-checkout", { body: { code, client_key: clientKey } });
  if (error) return { ok: false, code: await errorCodeOf(error) };
  const parsed = parseCheckout(data);
  return parsed ? { ok: true, ...parsed } : { ok: false, code: "unknown" };
}

/** Asks Paystack through our server whether the order is paid. A browser or app return is never proof by itself. */
export async function verifyOrder(reference: string): Promise<{ state: OrderRow["state"]; outcome: string } | null> {
  const { data, error } = await supabase.functions.invoke("order-verify", { body: { reference } });
  return error ? null : parseVerify(data);
}
