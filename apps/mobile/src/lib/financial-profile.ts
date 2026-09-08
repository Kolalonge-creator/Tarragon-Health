import { supabase } from "./supabase";
import type { QueryResult } from "./medications";

export interface LedgerEntry {
  entry_id: string;
  payment_transaction_id: string | null;
  posted_at: string;
  service_label: string;
  direction: string;
  payer_label: string;
  recipient_label: string;
  amount_minor: number;
  status: string;
}

export interface ActiveService {
  id: string;
  status: string;
  payable_kobo: number | null;
  currency: string;
  expires_at: string | null;
  service_product: { name: string } | null;
}

export interface CareVoucher {
  id: string;
  voucher_number: string;
  sku_name: string | null;
  kind: string;
  status: string;
  face_value_kobo: number;
  amount_paid_kobo: number;
  expires_at: string | null;
}

export interface VoucherRefund {
  id: string;
  voucher_id: string;
  amount_minor: number;
  currency: string;
  status: string;
  provider: string;
  created_at: string;
}

export interface PaymentFailure {
  id: string;
  error: string;
  created_at: string;
}

export interface PendingShare {
  id: string;
  amount_minor: number;
  transaction_subsidy: { order_type: string; gross_amount_kobo: number } | null;
}

export interface FinancialProfile {
  transactions: LedgerEntry[];
  activeServices: ActiveService[];
  vouchers: CareVoucher[];
  refunds: VoucherRefund[];
  recentFailures: PaymentFailure[];
  pendingShares: PendingShare[];
}

/**
 * §91.2 consolidated financial profile — mirrors apps/web/.../
 * financial-profile/page.tsx's parallel-query shape exactly (same tables,
 * same columns, same limits). Pure reads over data the patient already owns
 * under RLS; "Pay my share" and any voucher top-up stay a system-browser
 * hop to the web page (same pattern as Screening Days/Appointments'
 * pay-to-confirm) rather than reimplementing Paystack checkout initiation
 * natively.
 */
export async function loadFinancialProfile(userId: string): Promise<QueryResult<FinancialProfile>> {
  const [ledgerResult, servicePurchasesResult, vouchersResult, refundsResult, failedPaymentResult, subsidyShareResult] =
    await Promise.all([
      supabase.rpc("finance_unified_ledger", { p_profile_id: userId, p_limit: 20 }),
      supabase
        .from("service_purchases")
        .select("id, status, payable_kobo, currency, expires_at, service_product:service_products(name)")
        .eq("patient_id", userId)
        .eq("status", "active")
        .order("purchased_at", { ascending: false })
        .limit(10),
      supabase
        .from("care_vouchers")
        .select("id, voucher_number, sku_name, kind, status, face_value_kobo, amount_paid_kobo, expires_at")
        .eq("beneficiary_profile_id", userId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("voucher_refund_queue")
        .select("id, voucher_id, amount_minor, currency, status, provider, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("payment_transactions")
        .select("id, error, created_at")
        .not("error", "is", null)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("subsidy_contributions")
        .select("id, amount_minor, transaction_subsidy:transaction_subsidies(order_type, gross_amount_kobo)")
        .eq("payer_profile_id", userId)
        .eq("status", "pending_payment")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  if (ledgerResult.error) return { ok: false, error: ledgerResult.error.message };
  if (servicePurchasesResult.error) return { ok: false, error: servicePurchasesResult.error.message };
  if (vouchersResult.error) return { ok: false, error: vouchersResult.error.message };
  if (refundsResult.error) return { ok: false, error: refundsResult.error.message };
  if (failedPaymentResult.error) return { ok: false, error: failedPaymentResult.error.message };
  if (subsidyShareResult.error) return { ok: false, error: subsidyShareResult.error.message };

  return {
    ok: true,
    data: {
      transactions: (ledgerResult.data ?? []) as unknown as LedgerEntry[],
      activeServices: (servicePurchasesResult.data ?? []) as unknown as ActiveService[],
      vouchers: (vouchersResult.data ?? []) as unknown as CareVoucher[],
      refunds: (refundsResult.data ?? []) as unknown as VoucherRefund[],
      recentFailures: (failedPaymentResult.data ?? []) as unknown as PaymentFailure[],
      pendingShares: (subsidyShareResult.data ?? []) as unknown as PendingShare[],
    },
  };
}
