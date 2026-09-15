"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type CancelPendingPurchaseState = { error?: string } | undefined;

const cancelSchema = z.object({ servicePurchaseId: z.string().uuid() });

/**
 * "Not right now" on the patient dashboard's payment-failure banner
 * (payment-failure-banner.tsx) — a real close, not a client-side hide. Calls
 * cancel_pending_service_purchase (20260910222854), a SECURITY DEFINER RPC
 * that flips the caller's own still-pending_payment service_purchases row to
 * 'cancelled'; service_purchases_update in
 * 20260831140512_service_products_and_purchases_core.sql only lets org staff
 * write the table directly, so a plain client update can't do this.
 */
export async function cancelPendingServicePurchaseAction(
  _prev: CancelPendingPurchaseState,
  formData: FormData,
): Promise<CancelPendingPurchaseState> {
  const parsed = cancelSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Invalid request" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_pending_service_purchase", {
    p_service_purchase_id: parsed.data.servicePurchaseId,
  });
  if (error) return { error: "Could not close this — try again" };

  revalidatePath("/patient");
  return undefined;
}
