import { createClient } from "@/lib/supabase/server";

export interface UnmatchedTransferCandidate {
  kind: "voucher" | "lab" | "pharmacy" | "referral" | "video_visit";
  id: string;
  label: string;
  outstanding_kobo: number;
}

export interface UnmatchedTransferWithCandidates {
  id: string;
  amount_kobo: number;
  created_at: string;
  note: string | null;
  profile_id: string | null;
  payer_name: string | null;
  payer_phone: string | null;
  candidates: UnmatchedTransferCandidate[];
}

/** Every still-open queue entry, each with the payer's currently
 * outstanding vouchers/orders so staff can pick the right one without
 * knowing any ids by heart — same lookup shape as the assisted-redemption
 * flow, generalised to include vouchers too. */
export async function listUnmatchedTransfers(): Promise<UnmatchedTransferWithCandidates[]> {
  const supabase = await createClient();
  const { data: transfers } = await supabase
    .from("unmatched_bank_transfers")
    .select("id, amount_kobo, created_at, note, profile_id")
    .eq("status", "unmatched")
    .order("created_at", { ascending: true });
  if (!transfers || transfers.length === 0) return [];

  const results: UnmatchedTransferWithCandidates[] = [];
  for (const t of transfers) {
    if (!t.profile_id) {
      results.push({ ...t, payer_name: null, payer_phone: null, candidates: [] });
      continue;
    }

    const [{ data: payer }, { data: vouchers }, { data: labs }, { data: pharmacy }, { data: referrals }, { data: visits }] =
      await Promise.all([
        supabase.from("profiles").select("full_name, phone").eq("id", t.profile_id).maybeSingle(),
        supabase
          .from("care_vouchers")
          .select("id, sku_name, face_value_kobo, amount_paid_kobo")
          .eq("beneficiary_profile_id", t.profile_id)
          .eq("kind", "prepaid_service")
          .eq("status", "reserved"),
        supabase
          .from("lab_orders")
          .select("id, order_number, payable_kobo")
          .eq("patient_id", t.profile_id)
          .eq("status", "pending_payment"),
        supabase
          .from("pharmacy_orders")
          .select("id, payable_kobo")
          .eq("patient_id", t.profile_id)
          .eq("status", "pending_payment"),
        supabase
          .from("specialist_referrals")
          .select("id, payable_kobo")
          .eq("patient_id", t.profile_id)
          .eq("status", "pending_payment"),
        supabase
          .from("video_visit_requests")
          .select("id, amount_minor")
          .eq("patient_id", t.profile_id)
          .eq("status", "pending_payment"),
      ]);

    const candidates: UnmatchedTransferCandidate[] = [
      ...(vouchers ?? []).map((v) => ({
        kind: "voucher" as const,
        id: v.id,
        label: `Voucher — ${v.sku_name ?? "service"}`,
        outstanding_kobo: v.face_value_kobo - v.amount_paid_kobo,
      })),
      ...(labs ?? []).map((o) => ({
        kind: "lab" as const,
        id: o.id,
        label: `Lab order ${o.order_number ?? o.id.slice(0, 8)}`,
        outstanding_kobo: o.payable_kobo ?? 0,
      })),
      ...(pharmacy ?? []).map((o) => ({
        kind: "pharmacy" as const,
        id: o.id,
        label: `Pharmacy order ${o.id.slice(0, 8)}`,
        outstanding_kobo: o.payable_kobo ?? 0,
      })),
      ...(referrals ?? []).map((o) => ({
        kind: "referral" as const,
        id: o.id,
        label: `Referral ${o.id.slice(0, 8)}`,
        outstanding_kobo: o.payable_kobo ?? 0,
      })),
      ...(visits ?? []).map((o) => ({
        kind: "video_visit" as const,
        id: o.id,
        label: `Video visit ${o.id.slice(0, 8)}`,
        outstanding_kobo: o.amount_minor ?? 0,
      })),
    ];

    results.push({
      ...t,
      payer_name: payer?.full_name ?? null,
      payer_phone: payer?.phone ?? null,
      candidates,
    });
  }

  return results;
}
