"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { GLUCOSE_DISPLAY_UNITS, type GlucoseDisplayUnit } from "@tarragon/shared";

export type UpdateGlucoseUnitState = { success?: boolean; error?: string } | undefined;

function isDisplayUnit(value: unknown): value is GlucoseDisplayUnit {
  return typeof value === "string" && (GLUCOSE_DISPLAY_UNITS as readonly string[]).includes(value);
}

/**
 * Saves profiles.glucose_display_unit — the unit this patient reads their own
 * glucose figures in, and the default selected on the vitals entry forms.
 *
 * Display-only: vitals_readings always stores mmol/L, so switching this never
 * converts a stored reading and never changes a clinical threshold, a
 * red-flag classification or a risk score. Nothing downstream reads it.
 *
 * Writes as the patient's own session against RLS, not a service-role client.
 * profiles' self-update guard (private.guard_profiles_self_update) is
 * allow-by-default with an explicit denylist of privileged columns, and this
 * column is deliberately not on it: it is the account owner's own display
 * preference, and self-editing it is the entire point.
 */
export async function updateGlucoseDisplayUnit(
  _prev: UpdateGlucoseUnitState,
  formData: FormData
): Promise<UpdateGlucoseUnitState> {
  const unit = formData.get("glucose_display_unit");
  if (!isDisplayUnit(unit)) {
    return { error: "Pick either mg/dL or mmol/L." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in to change this." };

  const { error } = await supabase
    .from("profiles")
    .update({ glucose_display_unit: unit })
    .eq("id", user.id);

  if (error) return { error: "Couldn't save that. Please try again." };

  // Every glucose figure on the dashboard is server-rendered against this
  // preference, so the whole patient area is stale the moment it changes.
  revalidatePath("/patient", "layout");
  return { success: true };
}
