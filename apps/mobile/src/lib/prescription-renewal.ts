import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Enums } from "@tarragon/shared";

/**
 * Native data layer for pharmacy order payment — closes the gap
 * medicine-cabinet-screen.tsx's header comment used to flag as
 * deliberately not ported ("the paid prescription-renewal purchase flow").
 * Mirrors apps/web/src/lib/queries/pharmacy-orders.ts's
 * usePatientPharmacyOrders (a plain RLS-scoped read, same client every
 * other native screen already uses — see e.g. lib/lab-orders.ts) and
 * apps/web/src/lib/queries/platform-credit.ts's usePayPharmacyOrderWithCredit
 * (a direct `supabase.rpc()` call against
 * public.pay_pharmacy_order_on_platform_credit).
 *
 * Deliberately no mobile-passthrough Next.js route for the payment step:
 * that RPC is already SECURITY DEFINER, `grant execute ... to authenticated`,
 * and re-checks caller ownership/status/balance itself — exactly like every
 * other RPC this app already calls directly from the client (see e.g.
 * lib/appointments.ts's hold_appointment_slot, lib/care.ts's
 * complete_care_task). Adding a Next.js route that re-wraps a call this
 * client can already make safely and directly would be a redundant hop, not
 * a security boundary — same reasoning the web app already follows for this
 * exact RPC (apps/web/src/lib/queries/platform-credit.ts calls it straight
 * from the browser client, not through a server action).
 *
 * Read-only for order CREATION, deliberately: private.enforce_pharmacy_order_origin
 * does let a patient self-initiate an order (origin='patient_initiated',
 * refilling an existing clinician-prescribed medication — see
 * apps/web/src/lib/queries/pharmacy-orders.ts's useCreatePharmacyOrder /
 * pharmacy-catalogue.tsx), but every pharmacy_partners row is is_active=false
 * platform-wide today (20260803124833_self_arranged_lab_fulfilment.sql's
 * teardown, still true per the pharmacist-portal/dispensing migrations'
 * "dormant" comments through 2026-08-29) — that catalogue has nothing to
 * show on web either right now. Porting a creation flow with zero live
 * pharmacies to pick from would be new, untestable surface, not a WebView
 * replacement. What's real and live is a pharmacy_orders row a clinician/
 * system already created (the ordered_by path) sitting at pending_payment —
 * this file covers what a patient needs to do with one of those: see it,
 * and pay for it.
 */

export type PharmacyOrderStatus = Enums<"pharmacy_order_status">;
export type PharmacyFulfilmentMethod = Enums<"pharmacy_fulfilment_method">;

export interface PharmacyOrderItem {
  medication_id: string;
  drug_name: string;
  pack_size: string | null;
  price_kobo: number;
  quantity: number;
  requires_cold_chain?: boolean;
}

export interface PharmacyOrderListItem {
  id: string;
  orderNumber: string | null;
  status: PharmacyOrderStatus;
  items: PharmacyOrderItem[];
  totalKobo: number;
  /** What's actually owed (a generated column: total_kobo minus any
   * voucher_covered_kobo) — falls back to totalKobo only if the server ever
   * returns null, matching PayForPharmacyOrderButton's own fallback. */
  payableKobo: number;
  requestedAt: string;
  fulfilmentMethod: PharmacyFulfilmentMethod;
}

const PHARMACY_ORDER_SELECT =
  "id, order_number, status, items, total_kobo, payable_kobo, requested_at, fulfilment_method";

/** Patient's own pharmacy_orders, newest first — RLS (patient_id = auth.uid())
 * scopes it, the same plain client read every other native screen's own-data
 * list uses (see lib/lab-orders.ts's getLabOrders). */
export async function getPharmacyOrders(patientId: string): Promise<QueryResult<PharmacyOrderListItem[]>> {
  try {
    const { data, error } = await supabase
      .from("pharmacy_orders")
      .select(PHARMACY_ORDER_SELECT)
      .eq("patient_id", patientId)
      .order("requested_at", { ascending: false });
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      data: (data ?? []).map((row) => ({
        id: row.id,
        orderNumber: row.order_number,
        status: row.status,
        items: ((row.items as unknown as PharmacyOrderItem[] | null) ?? []),
        totalKobo: row.total_kobo,
        payableKobo: row.payable_kobo ?? row.total_kobo,
        requestedAt: row.requested_at,
        fulfilmentMethod: row.fulfilment_method,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Mirrors apps/web/src/lib/queries/platform-credit.ts's
 * PayPharmacyOrderWithCreditResult exactly — the RPC's own jsonb shape. */
export type PayPharmacyOrderWithCreditResult =
  | { ok: true; pharmacy_order_id: string; amount_kobo: number; new_balance_kobo: number }
  | { ok: true; already_active: boolean }
  | { ok: false; reason: "not_payable"; status: string }
  | {
      ok: false;
      reason: "insufficient_balance";
      balance_kobo: number;
      required_kobo: number;
      shortfall_kobo: number;
    };

/**
 * Pays a pending_payment pharmacy order entirely out of the caller's
 * platform credit balance — the same single RPC the web "Pay with Platform
 * Credit" dialog calls (public.pay_pharmacy_order_on_platform_credit checks
 * ownership/status/balance and activates the order atomically; see that
 * migration's header for the full mechanism). The `ok`/`error` envelope here
 * is only for a technical failure (network drop, RLS denial, RPC threw) — a
 * legitimate business rejection (not payable any more, insufficient
 * balance) comes back as `{ ok: true, data: { ok: false, reason: ... } }`,
 * exactly like every other QueryResult-wrapped RPC call in this app.
 */
export async function payPharmacyOrderWithCredit(
  pharmacyOrderId: string
): Promise<QueryResult<PayPharmacyOrderWithCreditResult>> {
  try {
    const { data, error } = await supabase.rpc("pay_pharmacy_order_on_platform_credit", {
      p_pharmacy_order_id: pharmacyOrderId,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: data as PayPharmacyOrderWithCreditResult };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Mirrors pharmacy-orders-list.tsx's itemsSummary. */
export function pharmacyOrderItemsSummary(items: PharmacyOrderItem[]): string {
  return items.map((item) => `${item.drug_name} × ${item.quantity}`).join(", ");
}

/** Mirrors pharmacy-orders-list.tsx's PHARMACY_ORDER_STATUS_BADGE labels
 * (tone names differ — this app's Pill only has green/amber/grey/red, not
 * web's five-colour Badge — so "blue"-toned web statuses map to the closest
 * native tone rather than growing a sixth Pill colour for one screen). */
export const PHARMACY_ORDER_STATUS_LABEL: Record<PharmacyOrderStatus, string> = {
  pending_payment: "Awaiting payment",
  payment_confirmed: "Booking confirmed",
  requested: "In progress",
  confirmed: "In progress",
  unavailable: "Medicine unavailable",
  dispensed: "Dispensed",
  out_for_delivery: "Out for delivery",
  delivery_failed: "Delivery attempt failed",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export function isPharmacyOrderPayable(status: PharmacyOrderStatus): boolean {
  return status === "pending_payment";
}
