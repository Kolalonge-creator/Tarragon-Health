import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type ClinicianConsultEarning = Tables<"clinician_consult_earnings">;

export const clinicianEarningsKeys = {
  mine: ["clinician-consult-earnings", "mine"] as const,
  accruedByClinician: ["clinician-consult-earnings", "accrued-by-clinician"] as const,
  bills: (status: string | null) => ["finance-bills", status ?? "all"] as const,
};

/** The signed-in doctor's own consult-fee ledger (self-service — RLS lets a
 * clinician see only their own rows). Empty for Tier 1-3 doctors: they're
 * salaried and never accrue a per-consult fee here. */
export function useMyClinicianEarnings() {
  return useQuery({
    queryKey: clinicianEarningsKeys.mine,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinician_consult_earnings")
        .select("*")
        .order("accrued_at", { ascending: false });
      if (error) throw error;
      return data as ClinicianConsultEarning[];
    },
  });
}

export type AccruedByClinicianRow = {
  clinicalStaffId: string;
  fullName: string;
  doctorTier: Tables<"clinical_staff">["doctor_tier"];
  currency: string;
  totalMinor: number;
  count: number;
};

/**
 * Finance/admin view: unbilled fees owed, totalled per contracted clinician.
 * RLS on clinician_consult_earnings only lets a finance/admin caller see
 * every org's rows at all — a non-finance caller simply gets their own rows
 * back (or none), so this stays a safe query to run from any role without a
 * separate permission check here; the settle/approve/pay actions below are
 * where the real authority gate lives (finance_can, DB-side).
 */
export function useAccruedEarningsByClinician() {
  return useQuery({
    queryKey: clinicianEarningsKeys.accruedByClinician,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinician_consult_earnings")
        .select(
          "clinical_staff_id, amount_minor, currency, clinician:clinical_staff!clinician_consult_earnings_clinical_staff_id_fkey(full_name, doctor_tier)"
        )
        .eq("status", "accrued");
      if (error) throw error;

      const byStaff = new Map<string, AccruedByClinicianRow>();
      for (const row of data ?? []) {
        const clinician = row.clinician as { full_name: string; doctor_tier: string } | null;
        const existing = byStaff.get(row.clinical_staff_id);
        if (existing) {
          existing.totalMinor += row.amount_minor;
          existing.count += 1;
        } else {
          byStaff.set(row.clinical_staff_id, {
            clinicalStaffId: row.clinical_staff_id,
            fullName: clinician?.full_name ?? "Unknown",
            doctorTier: (clinician?.doctor_tier ?? null) as Tables<"clinical_staff">["doctor_tier"],
            currency: row.currency,
            totalMinor: row.amount_minor,
            count: 1,
          });
        }
      }
      return [...byStaff.values()].sort((a, b) => b.totalMinor - a.totalMinor);
    },
  });
}

/** Rolls a clinician's accrued earnings into one finance_bills row via
 * finance_settle_clinician_earnings — the finance authority check
 * (finance.vendors.manage) lives in the RPC itself. */
export function useSettleClinicianEarnings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (clinicalStaffId: string) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("finance_settle_clinician_earnings", {
        p_clinical_staff_id: clinicalStaffId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clinicianEarningsKeys.accruedByClinician });
      queryClient.invalidateQueries({ queryKey: clinicianEarningsKeys.mine });
      queryClient.invalidateQueries({ queryKey: clinicianEarningsKeys.bills(null) });
      queryClient.invalidateQueries({ queryKey: clinicianEarningsKeys.bills("draft") });
    },
  });
}

export type FinanceBillRow = {
  id: string;
  bill_no: number;
  vendor_id: string;
  vendor_name: string;
  bill_date: string;
  due_date: string | null;
  currency: string;
  amount_minor: number;
  expense_account_code: string;
  cost_center_code: string | null;
  description: string | null;
  status: string;
  wht_minor: number;
  paid_at: string | null;
};

/** Bills in the caller's finance queue, optionally filtered by status
 * ('draft' | 'approved' | 'paid' | 'void'). Reuses the existing, already-
 * built accounts-payable RPC — clinician payout bills show up alongside
 * every other vendor bill, same audit trail. */
export function useFinanceBills(status: string | null = null) {
  return useQuery({
    queryKey: clinicianEarningsKeys.bills(status),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("finance_bills_list", {
        p_status: status ?? undefined,
      });
      if (error) throw error;
      return (data ?? []) as unknown as FinanceBillRow[];
    },
  });
}

export function useApproveFinanceBill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (billId: string) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("finance_approve_bill", { p_id: billId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finance-bills"] });
    },
  });
}

export function usePayFinanceBill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { billId: string; bankAccountCode: string; paidDate: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("finance_pay_bill", {
        p_id: input.billId,
        p_bank_account_code: input.bankAccountCode,
        p_paid_date: input.paidDate,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finance-bills"] });
      queryClient.invalidateQueries({ queryKey: clinicianEarningsKeys.mine });
    },
  });
}
