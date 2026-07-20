"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type AttestationState = { error?: string; success?: boolean } | undefined;

/**
 * A doctor attests they know and will act on the diabetes red flags (§25).
 * Stamps red_flag_attested_at on THEIR OWN clinical_staff row — the row is
 * resolved server-side from auth.uid() (never client-supplied) and written with
 * the service-role client after that ownership check, so a doctor can only ever
 * attest for themselves. Re-attest annually.
 */
export async function attestRedFlags(): Promise<AttestationState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("id")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!staff) return { error: "No active care-team record for your account" };

  const today = new Date().toISOString().slice(0, 10);
  const { error } = await createServiceRoleClient()
    .from("clinical_staff")
    .update({ red_flag_attested_at: today })
    .eq("id", staff.id);
  if (error) return { error: error.message };

  revalidatePath("/clinician");
  return { success: true };
}
