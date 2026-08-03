"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export type EmergencyCardActionResult = { error?: string; success?: boolean; message?: string };

/**
 * Create (or rotate) the caller's own LIVE LINK — the opt-in extra on top of
 * the printed card (2026-08-03 redesign).
 *
 * Takes no patient argument by design — `public.create_emergency_card()` acts
 * only on auth.uid(), so there is no parameter through which one person could
 * mint a link for another. Proven in packages/db/tests/emergency_cards.sql.
 *
 * Calling this again ROTATES: the previous token stops working immediately and
 * a fresh 12-month expiry starts. That is the answer to a shared or lost link.
 */
export async function createEmergencyCardAction(): Promise<EmergencyCardActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_emergency_card");
  if (error) return { error: error.message };

  revalidatePath("/patient/emergency-card");
  return {
    success: true,
    message: "Your live link is ready. It lasts 12 months and you'll be reminded before it expires.",
  };
}

export async function revokeEmergencyCardAction(): Promise<EmergencyCardActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_emergency_card");
  if (error) return { error: error.message };

  revalidatePath("/patient/emergency-card");
  return {
    success: true,
    message: "Your live link has been withdrawn. Your printed card is unaffected.",
  };
}
