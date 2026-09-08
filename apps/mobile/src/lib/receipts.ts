import { supabase } from "./supabase";
import type { QueryResult } from "./medications";

export type PatientReceiptServiceType =
  | "membership"
  | "laboratory"
  | "pharmacy"
  | "referral"
  | "consultation"
  | "care_voucher";

export type PatientReceiptStatus = "successful" | "pending" | "failed" | "refunded" | "pending_refund";

export interface PatientReceipt {
  id: string;
  occurred_at: string;
  service_type: PatientReceiptServiceType;
  service_label: string;
  reference: string;
  amount_minor: number;
  currency: string;
  status: PatientReceiptStatus;
  provider: string | null;
}

/** Mirrors apps/web/src/lib/queries/receipts.ts's usePatientReceipts — a
 * single RPC, always scoped to auth.uid() server-side. */
export async function loadPatientReceipts(): Promise<QueryResult<PatientReceipt[]>> {
  const { data, error } = await supabase.rpc("patient_receipts");
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as unknown as PatientReceipt[] };
}
