"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { MAX_HOME_PINS, resolveHomePins, sanitizeHomePins } from "@tarragon/shared";

export type SaveHomePinsResult = { ok: true } | { ok: false; error: string };

// Unknown keys are dropped by sanitizeHomePins rather than refused: an older
// open tab must not be unable to save because the list has since grown.
const inputSchema = z.array(z.string().max(40)).max(MAX_HOME_PINS * 4);

/**
 * Saves the signed-in patient's own pinned tiles, in order.
 *
 * Writes as the patient's own session against RLS (patient_home_layout allows a
 * patient to write only their own row). A supporter calling this can only ever
 * change their own layout, never the person they are acting for.
 *
 * The pins that cannot be removed (today's doses for anyone taking a medication)
 * are re-derived here from live data and added back, so a hand-built request
 * cannot drop one.
 */
export async function saveHomePins(pins: unknown): Promise<SaveHomePinsResult> {
  const parsed = inputSchema.safeParse(pins);
  if (!parsed.success) return { ok: false, error: "That list of tiles didn't look right. Please try again." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in to change this." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) return { ok: false, error: "Couldn't save that. Please try again." };

  const { count, error: countError } = await supabase
    .from("medications")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", user.id)
    .eq("is_active", true);

  // The pin that must stay on depends on this count; a failed read must not pass for "no medications".
  if (countError || count === null) return { ok: false, error: "Couldn't save that. Please try again." };

  // An empty `sanitize` result is a real choice ("show nothing"); resolve only adds back what is locked.
  const toSave = resolveHomePins(sanitizeHomePins(parsed.data), { activeMedicationCount: count }, []);

  const { error } = await supabase
    .from("patient_home_layout")
    .upsert(
      { patient_id: user.id, organisation_id: profile.organisation_id, pinned: toSave },
      { onConflict: "patient_id" },
    );
  if (error) return { ok: false, error: "Couldn't save that. Please try again." };

  revalidatePath("/patient");
  return { ok: true };
}
