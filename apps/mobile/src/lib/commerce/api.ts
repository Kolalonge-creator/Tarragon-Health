import type { QueryResult } from "../medications";
import { supabase } from "../supabase";
import { parseCreatedPaymentRequest, parseEntitlements, parsePaymentRequests, parseQuote, type CreatedPaymentRequest, type EntitlementView, type PaymentRequestRow, type Quote } from "@tarragon/commerce";
import { parseCatalogue, parseCheckout, parseCovered, parseMembership, parseOrders, parseVerify, type CatalogueItem, type MembershipState, type OrderRow } from "./parse";

/** The patient side of S25 checkout. Only the item code and a retry key are ever sent; the price comes from the database. */
export type CheckoutResult =
  | { ok: true; covered?: false; reference: string; checkoutUrl: string }
  | { ok: true; covered: true; reference: string; sponsorName: string | null }
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

/** `beneficiary` is set only when paying for someone in the caller's Care Circle (S29); the database decides whether that is allowed. */
export async function startCheckout(code: string, clientKey: string, beneficiary?: string, extras?: { usePoints?: boolean; expectedAmountKobo?: number }): Promise<CheckoutResult> {
  // S72 (19.9): Health Points lower only Tarragon's own fee, for this one payment, and only when the person chose. The total they were shown is sent so the
  // database refuses the order if it now works out a different one.
  const body = {
    code, client_key: clientKey, ...(beneficiary ? { beneficiary } : {}),
    ...(extras?.usePoints ? { use_points: true } : {}), ...(extras?.expectedAmountKobo !== undefined ? { expected_amount_kobo: extras.expectedAmountKobo } : {}),
  };
  const { data, error } = await supabase.functions.invoke("order-checkout", { body });
  if (error) return { ok: false, code: await errorCodeOf(error) };
  const covered = parseCovered(data);
  if (covered) return { ok: true, covered: true, ...covered };
  const parsed = parseCheckout(data);
  return parsed ? { ok: true, ...parsed } : { ok: false, code: "unknown" };
}

/** Asks Paystack through our server whether the order is paid. A browser or app return is never proof by itself. */
export async function verifyOrder(reference: string): Promise<{ state: OrderRow["state"]; outcome: string } | null> {
  const { data, error } = await supabase.functions.invoke("order-verify", { body: { reference } });
  return error ? null : parseVerify(data);
}

/** What the person would pay for one item, from the database's own quote (S73). null means "could not be worked out": the screen then shows the catalogue price and sends no expected total. */
export async function loadQuote(code: string, usePoints = false, beneficiary?: string): Promise<Quote | null> {
  const { data, error } = await supabase.rpc("price_quote", { p_code: code, ...(beneficiary ? { p_beneficiary: beneficiary } : {}), ...(usePoints ? { p_use_points: true } : {}) });
  return error ? null : parseQuote(data);
}

/** What the person has, where each came from, and what is left (S72, 19.12). */
export async function loadEntitlements(): Promise<QueryResult<EntitlementView[]>> {
  const { data, error } = await supabase.rpc("my_entitlements");
  return error ? { ok: false, error: error.message } : { ok: true, data: parseEntitlements(data) };
}

/** Asks for a refund of a paid order the person bought (S72, 19.8). The database decides; the reply is a stable word. */
export async function requestRefund(orderId: string, reason: string): Promise<{ result: string } | null> {
  const { data, error } = await supabase.rpc("request_order_refund", { p_order: orderId, p_reason: reason });
  if (error) return null;
  const r = (data as { result?: unknown } | null)?.result;
  return typeof r === "string" ? { result: r } : null;
}

/** Payment requests (S72, 19.13). The link's code is returned once, when it is made, and never listed again. */
export async function loadPaymentRequests(): Promise<QueryResult<PaymentRequestRow[]>> {
  const { data, error } = await supabase.rpc("my_payment_requests");
  return error ? { ok: false, error: error.message } : { ok: true, data: parsePaymentRequests(data) };
}
export async function createPaymentRequest(itemCode: string): Promise<{ ok: true; request: CreatedPaymentRequest } | { ok: false; code: string }> {
  const { data, error } = await supabase.rpc("create_payment_request", { p_item_code: itemCode });
  if (error) return { ok: false, code: /([a-z]+(?:_[a-z]+)+)/.exec(error.message)?.[1] ?? "unknown" };
  const request = parseCreatedPaymentRequest(data);
  return request ? { ok: true, request } : { ok: false, code: "unknown" };
}
export async function cancelPaymentRequest(id: string): Promise<string> {
  const { data, error } = await supabase.rpc("cancel_payment_request", { p_id: id });
  return error ? "unknown" : ((data as { result?: string } | null)?.result ?? "unknown");
}
