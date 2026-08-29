"use server";

import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";

export type AssistedRedeemState = { error?: string; message?: string } | undefined;

const schema = z.object({
  voucher_number: z.string().trim().min(1, "Enter the voucher number"),
  beneficiary_phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/, "Enter the phone in E.164 form, e.g. +2348012345678"),
  order_type: z.enum(["lab", "pharmacy", "referral"]),
  order_id: z.string().uuid("Enter a valid order id"),
});

/**
 * The phone-support-desk redemption path for a beneficiary with no app/web
 * access (revenue-architecture spec §6) — verifies the caller against the
 * beneficiary's phone on file before letting the voucher pay for anything.
 * Looks the voucher up by its human-readable number rather than a raw id,
 * since that's what a person reads out over a call.
 */
export async function assistedRedeemAction(
  _prev: AssistedRedeemState,
  formData: FormData
): Promise<AssistedRedeemState> {
  const staff = await getCurrentProfile();
  if (!staff || staff.role === "patient" || !staff.organisation_id) {
    return { error: "Staff access required" };
  }

  const parsed = schema.safeParse({
    voucher_number: formData.get("voucher_number"),
    beneficiary_phone: formData.get("beneficiary_phone"),
    order_type: formData.get("order_type"),
    order_id: formData.get("order_id"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }

  const supabase = await createClient();
  const { data: voucher, error: lookupError } = await supabase
    .from("care_vouchers")
    .select("id")
    .eq("voucher_number", parsed.data.voucher_number.toUpperCase().trim())
    .maybeSingle();
  if (lookupError || !voucher) {
    return { error: "No voucher found with that number." };
  }

  const { data, error } = await supabase.rpc("redeem_care_voucher_assisted", {
    p_voucher: voucher.id,
    p_beneficiary_phone: parsed.data.beneficiary_phone,
    p_order_type: parsed.data.order_type,
    p_order_id: parsed.data.order_id,
  });
  if (error) return { error: error.message };
  const result = data as { ok: boolean; error?: string; covered_kobo?: number };
  if (!result.ok) return { error: result.error ?? "Could not redeem this voucher" };

  return { message: `Redeemed — ₦${((result.covered_kobo ?? 0) / 100).toLocaleString()} applied.` };
}

export type PendingOrder = { id: string; type: "lab" | "pharmacy" | "referral"; label: string; payable_kobo: number };
export type LookupState =
  | { error: string }
  | { orders: PendingOrder[]; beneficiaryName: string | null }
  | undefined;

const lookupSchema = z.object({
  voucher_number: z.string().trim().min(1, "Enter the voucher number"),
  beneficiary_phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/, "Enter the phone in E.164 form"),
});

/**
 * Read-only preview for the coordinator: confirms the phone matches the
 * voucher's beneficiary on file (same check redeem_care_voucher_assisted
 * makes, so a wrong guess never even reveals whose orders exist), then
 * lists that beneficiary's own orders still awaiting payment so the
 * coordinator can pick one instead of needing to already know its id.
 */
export async function lookupPendingOrdersAction(_prev: LookupState, formData: FormData): Promise<LookupState> {
  const staff = await getCurrentProfile();
  if (!staff || staff.role === "patient" || !staff.organisation_id) {
    return { error: "Staff access required" };
  }
  const parsed = lookupSchema.safeParse({
    voucher_number: formData.get("voucher_number"),
    beneficiary_phone: formData.get("beneficiary_phone"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid details" };

  const supabase = await createClient();
  const { data: voucher } = await supabase
    .from("care_vouchers")
    .select("beneficiary_profile_id, status")
    .eq("voucher_number", parsed.data.voucher_number.toUpperCase().trim())
    .maybeSingle();
  if (!voucher) return { error: "No voucher found with that number." };
  if (voucher.status !== "active") return { error: `This voucher is ${voucher.status}, not redeemable.` };

  const { data: beneficiary } = await supabase
    .from("profiles")
    .select("id, full_name, phone")
    .eq("id", voucher.beneficiary_profile_id)
    .maybeSingle();
  if (!beneficiary || beneficiary.phone !== parsed.data.beneficiary_phone) {
    return { error: "That phone number does not match the beneficiary on file for this voucher." };
  }

  const [{ data: labs }, { data: pharmacy }, { data: referrals }] = await Promise.all([
    supabase
      .from("lab_orders")
      .select("id, payable_kobo, order_number")
      .eq("patient_id", beneficiary.id)
      .eq("status", "pending_payment"),
    supabase
      .from("pharmacy_orders")
      .select("id, payable_kobo")
      .eq("patient_id", beneficiary.id)
      .eq("status", "pending_payment"),
    supabase
      .from("specialist_referrals")
      .select("id, payable_kobo")
      .eq("patient_id", beneficiary.id)
      .eq("status", "pending_payment"),
  ]);

  const orders: PendingOrder[] = [
    ...(labs ?? []).map((o) => ({
      id: o.id,
      type: "lab" as const,
      label: `Lab order ${o.order_number ?? o.id.slice(0, 8)}`,
      payable_kobo: o.payable_kobo ?? 0,
    })),
    ...(pharmacy ?? []).map((o) => ({
      id: o.id,
      type: "pharmacy" as const,
      label: `Pharmacy order ${o.id.slice(0, 8)}`,
      payable_kobo: o.payable_kobo ?? 0,
    })),
    ...(referrals ?? []).map((o) => ({
      id: o.id,
      type: "referral" as const,
      label: `Referral ${o.id.slice(0, 8)}`,
      payable_kobo: o.payable_kobo ?? 0,
    })),
  ];

  return { orders, beneficiaryName: beneficiary.full_name };
}
