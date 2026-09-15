import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export type PatientReceiptServiceType =
  | "membership"
  | "laboratory"
  | "pharmacy"
  | "referral"
  | "consultation"
  | "care_voucher";

export type PatientReceiptStatus =
  "successful" | "pending" | "failed" | "refunded" | "pending_refund";

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
  /**
   * The real amount Paystack actually charged and the fee it kept, read
   * from the same charge.success payment_transactions row activation
   * itself matched on (20260910231326_receipts_show_paystack_fee_
   * breakdown.sql) — null for every service_type except 'membership', and
   * null there too for a free/voucher-covered activation with no real
   * Paystack charge behind it. Never a guess: Paystack only reveals its
   * fee once a charge completes, so there is nothing to show before that.
   */
  charged_amount_minor: number | null;
  fee_minor: number | null;
}

/** Every payment the signed-in patient made — membership, lab, pharmacy,
 * referral, video consultation, and care-voucher instalments they paid for
 * themselves. Always scoped to auth.uid() by the RPC itself (see
 * 20260829001259_patient_receipts.sql) — nothing here can be pointed at
 * another patient. */
export function usePatientReceipts() {
  return useQuery({
    queryKey: ["patient", "receipts"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("patient_receipts");
      if (error) throw error;
      return (data ?? []) as unknown as PatientReceipt[];
    },
  });
}
