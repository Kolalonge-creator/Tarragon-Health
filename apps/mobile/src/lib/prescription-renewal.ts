import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Enums } from "@tarragon/shared";

/**
 * Native data layer for pharmacy order payment — closes the gap
 * medicine-cabinet-screen.tsx's header comment used to flag as
 * deliberately not ported ("the paid prescription-renewal purchase flow").
 * Mirrors apps/web/src/lib/queries/pharmacy-orders.ts's
 * usePatientPharmacyOrders (a plain RLS-scoped read, same client every
 * other native screen already uses — see e.g. lib/lab-orders.ts). Payment
 * is by card only, handed off to the web payment page in the system browser
 * (see pharmacy-orders-section.tsx); there is no in-app payment call here.
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
 * and open the web page to pay for it.
 */

export type PharmacyOrderStatus = Enums<"pharmacy_order_status">;

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
}

const PHARMACY_ORDER_SELECT =
  "id, order_number, status, items, total_kobo, payable_kobo, requested_at";

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
      })),
    };
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
  cancelled: "Cancelled",
};

export function isPharmacyOrderPayable(status: PharmacyOrderStatus): boolean {
  return status === "pending_payment";
}
