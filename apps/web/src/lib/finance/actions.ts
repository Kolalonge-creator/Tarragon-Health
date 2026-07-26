"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@tarragon/shared";

/**
 * Finance write actions. Each calls a SECURITY DEFINER RPC that is the real
 * authorization gate (private.finance_can(<capability>)) — a finance/admin
 * account, or a member granted the specific capability. The action layer just
 * surfaces the RPC's result; it never bypasses the gate.
 */

export type FinanceActionResult = { ok: boolean; error?: string; data?: unknown };

export interface JournalLineInput {
  account_code: string;
  debit_minor: number;
  credit_minor: number;
  memo?: string;
  counterparty?: string;
}

function revalidateFinance() {
  revalidatePath("/finance", "layout");
}

export async function postManualJournalAction(input: {
  entry_date: string;
  currency: string;
  memo: string;
  lines: JournalLineInput[];
}): Promise<FinanceActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_post_manual_journal", {
    p_entry_date: input.entry_date,
    p_currency: input.currency,
    p_memo: input.memo,
    p_lines: input.lines as unknown as Json,
  });
  if (error) return { ok: false, error: error.message };
  revalidateFinance();
  return { ok: true, data };
}

export async function reverseJournalAction(
  entryId: string,
  reason: string,
): Promise<FinanceActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_reverse_journal", {
    p_entry: entryId,
    p_reason: reason,
  });
  if (error) return { ok: false, error: error.message };
  revalidateFinance();
  return { ok: true, data };
}

export async function setPeriodStatusAction(
  month: string,
  status: "open" | "closed" | "locked",
): Promise<FinanceActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_set_period_status", {
    p_month: month,
    p_status: status,
  });
  if (error) return { ok: false, error: error.message };
  revalidateFinance();
  return { ok: true };
}

export async function upsertAccountAction(input: {
  code: string;
  name: string;
  type: string;
  normal_balance: string;
  vat_treatment: string;
  is_active: boolean;
  sort_order: number;
  description: string;
}): Promise<FinanceActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_upsert_account", {
    p_code: input.code,
    p_name: input.name,
    p_type: input.type,
    p_normal_balance: input.normal_balance,
    p_vat_treatment: input.vat_treatment,
    p_is_active: input.is_active,
    p_sort_order: input.sort_order,
    p_description: input.description,
  });
  if (error) return { ok: false, error: error.message };
  revalidateFinance();
  return { ok: true };
}

export async function upsertTaxRateAction(input: {
  id: string | null;
  jurisdiction: string;
  tax_type: string;
  name: string;
  rate_pct: number;
  applies_to: string;
  effective_from: string;
  is_active: boolean;
  notes: string;
}): Promise<FinanceActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_upsert_tax_rate", {
    p_id: input.id,
    p_jurisdiction: input.jurisdiction,
    p_tax_type: input.tax_type,
    p_name: input.name,
    p_rate_pct: input.rate_pct,
    p_applies_to: input.applies_to,
    p_effective_from: input.effective_from,
    p_is_active: input.is_active,
    p_notes: input.notes,
  });
  if (error) return { ok: false, error: error.message };
  revalidateFinance();
  return { ok: true };
}

export async function importSettlementAction(input: {
  provider: string;
  external_ref: string;
  settlement_date: string;
  currency: string;
  gross_minor: number;
  fees_minor: number;
  net_minor: number;
  bank_account_code: string;
  notes: string;
}): Promise<FinanceActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_import_settlement", {
    p_provider: input.provider,
    p_external_ref: input.external_ref,
    p_settlement_date: input.settlement_date,
    p_currency: input.currency,
    p_gross: input.gross_minor,
    p_fees: input.fees_minor,
    p_net: input.net_minor,
    p_bank_account: input.bank_account_code,
    p_notes: input.notes,
  });
  if (error) return { ok: false, error: error.message };
  revalidateFinance();
  return { ok: true, data };
}

export async function matchPaymentAction(
  settlementId: string,
  paymentTransactionId: string,
  amountMinor: number,
): Promise<FinanceActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_match_payment", {
    p_settlement_id: settlementId,
    p_payment_transaction_id: paymentTransactionId,
    p_amount: amountMinor,
  });
  if (error) return { ok: false, error: error.message };
  revalidateFinance();
  return { ok: true };
}

export async function unmatchPaymentAction(paymentTransactionId: string): Promise<FinanceActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_unmatch_payment", {
    p_payment_transaction_id: paymentTransactionId,
  });
  if (error) return { ok: false, error: error.message };
  revalidateFinance();
  return { ok: true };
}

export async function postSettlementAction(settlementId: string): Promise<FinanceActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("finance_post_settlement", { p_settlement_id: settlementId });
  if (error) return { ok: false, error: error.message };
  revalidateFinance();
  return { ok: true };
}

export async function runRevenueRecognitionAction(): Promise<FinanceActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_run_revenue_recognition");
  if (error) return { ok: false, error: error.message };
  revalidateFinance();
  return { ok: true, data };
}
