"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { nairaToKobo } from "@tarragon/shared";

export type PlatformCreditLedgerRow = {
  id: string;
  entryType: string;
  amountKobo: number;
  paidAmountKobo: number;
  promoAmountKobo: number;
  balanceAfterKobo: number;
  description: string | null;
  createdAt: string;
};

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") throw new Error("Admin access required");
  return profile;
}

/**
 * A patient's own recent platform_credit_ledger_entries — read through the
 * admin's own session (not a service-role client), so this proves the same
 * RLS an admin's browser session already relies on
 * (platform_credit_ledger_entries_select: patient_id = auth.uid() OR
 * private.is_org_staff(organisation_id), and is_org_staff admits `admin`
 * unconditionally) rather than bypassing it. There is no dedicated RPC for
 * this because none is needed — the table's own SELECT policy already
 * covers it.
 */
export async function getPlatformCreditLedgerAction(patientId: string): Promise<PlatformCreditLedgerRow[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("platform_credit_ledger_entries")
    .select(
      "id, entry_type, amount_kobo, paid_amount_kobo, promo_amount_kobo, balance_after_kobo, description, created_at",
    )
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    entryType: r.entry_type,
    amountKobo: r.amount_kobo ?? 0,
    paidAmountKobo: r.paid_amount_kobo,
    promoAmountKobo: r.promo_amount_kobo,
    balanceAfterKobo: r.balance_after_kobo,
    description: r.description,
    createdAt: r.created_at,
  }));
}

export type PlatformCreditActionState =
  | { error?: string; message?: string; newBalanceKobo?: number }
  | undefined;

const grantSchema = z.object({
  patientId: z.string().uuid(),
  amountNaira: z.coerce.number().positive().max(10_000_000),
  reason: z.string().trim().min(3, "A reason is required.").max(500),
});

/**
 * Admin-issued goodwill credit (public.grant_platform_credit) — always the
 * promo bucket, nobody paid. The RPC itself re-checks private.is_admin(), so
 * this server-action-level check is defense in depth, not the real gate.
 */
export async function grantPlatformCreditAction(
  _prev: PlatformCreditActionState,
  formData: FormData,
): Promise<PlatformCreditActionState> {
  const admin = await requireAdmin();
  const parsed = grantSchema.safeParse({
    patientId: formData.get("patientId"),
    amountNaira: formData.get("amountNaira"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the values and try again." };
  }
  const amountKobo = nairaToKobo(parsed.data.amountNaira);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("grant_platform_credit", {
    p_patient_id: parsed.data.patientId,
    p_amount_kobo: amountKobo,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: error.message };

  const svc = createServiceRoleClient();
  await svc.from("audit_log").insert({
    actor_id: admin.id,
    organisation_id: admin.organisation_id,
    action: "admin.platform_credit_granted",
    entity_type: "platform_credit_balances",
    entity_id: parsed.data.patientId,
    event: { amount_kobo: amountKobo, reason: parsed.data.reason },
  });

  revalidatePath("/admin/patients");
  return { message: "Credit granted.", newBalanceKobo: data as number };
}

const correctSchema = z.object({
  patientId: z.string().uuid(),
  bucket: z.enum(["paid", "promo"]),
  direction: z.enum(["increase", "decrease"]),
  amountNaira: z.coerce.number().positive().max(10_000_000),
  reason: z.string().trim().min(3, "A reason is required.").max(500),
});

/**
 * Rare manual reconciliation fix (public.correct_platform_credit) — e.g. a
 * bank-transfer top-up settled outside Paystack, or reversing an erroneous
 * grant/topup. Never the everyday way a balance changes; the RPC itself
 * refuses a 'decrease' that would take a bucket negative.
 */
export async function correctPlatformCreditAction(
  _prev: PlatformCreditActionState,
  formData: FormData,
): Promise<PlatformCreditActionState> {
  const admin = await requireAdmin();
  const parsed = correctSchema.safeParse({
    patientId: formData.get("patientId"),
    bucket: formData.get("bucket"),
    direction: formData.get("direction"),
    amountNaira: formData.get("amountNaira"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the values and try again." };
  }
  const amountKobo = nairaToKobo(parsed.data.amountNaira);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("correct_platform_credit", {
    p_patient_id: parsed.data.patientId,
    p_bucket: parsed.data.bucket,
    p_direction: parsed.data.direction,
    p_amount_kobo: amountKobo,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: error.message };

  const svc = createServiceRoleClient();
  await svc.from("audit_log").insert({
    actor_id: admin.id,
    organisation_id: admin.organisation_id,
    action: "admin.platform_credit_corrected",
    entity_type: "platform_credit_balances",
    entity_id: parsed.data.patientId,
    event: {
      bucket: parsed.data.bucket,
      direction: parsed.data.direction,
      amount_kobo: amountKobo,
      reason: parsed.data.reason,
    },
  });

  revalidatePath("/admin/patients");
  return { message: "Balance corrected.", newBalanceKobo: data as number };
}
