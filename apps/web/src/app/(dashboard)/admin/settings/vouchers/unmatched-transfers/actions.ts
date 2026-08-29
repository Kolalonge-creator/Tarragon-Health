"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

export type ResolveTransferState = { error?: string; message?: string } | undefined;

async function requireFinanceReconcile() {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in");
  const allowed = profile.role === "admin" || (await hasPermission("finance.reconcile"));
  if (!allowed) throw new Error("Not authorised to reconcile bank transfers");
}

const applyVoucherSchema = z.object({
  transfer_id: z.string().uuid(),
  voucher_id: z.string().uuid(),
  note: z.string().trim().optional(),
});

export async function applyToVoucherAction(
  _prev: ResolveTransferState,
  formData: FormData
): Promise<ResolveTransferState> {
  await requireFinanceReconcile();
  const parsed = applyVoucherSchema.safeParse({
    transfer_id: formData.get("transfer_id"),
    voucher_id: formData.get("voucher_id"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid details" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resolve_unmatched_bank_transfer", {
    p_transfer_id: parsed.data.transfer_id,
    p_action: "apply_to_voucher",
    p_source_id: parsed.data.voucher_id,
    p_note: parsed.data.note ?? null,
  });
  if (error) return { error: error.message };
  const result = data as { ok: boolean; error?: string; credited_kobo?: number };
  if (!result.ok) return { error: result.error };

  revalidatePath("/admin/settings/vouchers/unmatched-transfers");
  return { message: `Applied ₦${((result.credited_kobo ?? 0) / 100).toLocaleString()} to the voucher.` };
}

const applyBookingSchema = z.object({
  transfer_id: z.string().uuid(),
  booking_type: z.enum(["lab", "pharmacy", "referral", "video_visit"]),
  booking_id: z.string().uuid(),
  note: z.string().trim().optional(),
});

export async function applyToBookingAction(
  _prev: ResolveTransferState,
  formData: FormData
): Promise<ResolveTransferState> {
  await requireFinanceReconcile();
  const parsed = applyBookingSchema.safeParse({
    transfer_id: formData.get("transfer_id"),
    booking_type: formData.get("booking_type"),
    booking_id: formData.get("booking_id"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid details" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resolve_unmatched_bank_transfer", {
    p_transfer_id: parsed.data.transfer_id,
    p_action: "apply_to_booking",
    p_source_id: parsed.data.booking_id,
    p_note: parsed.data.note ?? null,
    p_booking_type: parsed.data.booking_type,
  });
  if (error) return { error: error.message };
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return { error: result.error };

  revalidatePath("/admin/settings/vouchers/unmatched-transfers");
  return { message: "Order marked paid." };
}

export async function ignoreTransferAction(
  _prev: ResolveTransferState,
  formData: FormData
): Promise<ResolveTransferState> {
  await requireFinanceReconcile();
  const transferId = formData.get("transfer_id");
  if (typeof transferId !== "string" || !transferId) return { error: "Missing transfer" };
  const note = formData.get("note");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resolve_unmatched_bank_transfer", {
    p_transfer_id: transferId,
    p_action: "ignore",
    p_note: typeof note === "string" && note ? note : null,
  });
  if (error) return { error: error.message };
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return { error: result.error };

  revalidatePath("/admin/settings/vouchers/unmatched-transfers");
  return { message: "Marked ignored." };
}
