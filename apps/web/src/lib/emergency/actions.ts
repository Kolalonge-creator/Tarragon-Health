"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export type EmergencyCardActionResult = { error?: string; success?: boolean; message?: string };

/**
 * Create (or rotate) the caller's own emergency card.
 *
 * Takes no patient argument by design — `public.create_emergency_card()` acts
 * only on auth.uid(), so there is no parameter through which one person could
 * mint a card for another. Proven in packages/db/tests/emergency_cards.sql.
 *
 * Calling this again ROTATES: the previous token stops working immediately.
 * That is the answer to a printed card being lost.
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
    message: "Your emergency card is ready. Print it or save it to your phone.",
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
    message: "Your card has been withdrawn. Any printed copy or link stops working now.",
  };
}
