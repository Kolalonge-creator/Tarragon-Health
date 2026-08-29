"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function declineChronicOfferAction(offerId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("decline_chronic_programme_offer", { p_offer_id: offerId });
  if (error) return { error: error.message };
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return { error: result.error };
  revalidatePath("/patient");
  return {};
}
