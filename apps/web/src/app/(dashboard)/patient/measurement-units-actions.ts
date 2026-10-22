"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isLengthDisplayUnit, isTemperatureDisplayUnit, isWeightDisplayUnit } from "@tarragon/shared";

export type UpdateMeasurementUnitsState = { success?: boolean; error?: string } | undefined;

/**
 * Saves profiles.weight_display_unit, temperature_display_unit and length_display_unit: the units this person
 * reads weight, temperature and waist/height in. Display and entry-form default only; vitals_readings keeps
 * kg / degrees C / cm, so switching never converts a stored reading and never touches a threshold or red flag.
 * Written as the patient's own session against RLS (the columns are deliberately not on the self-update denylist).
 */
export async function updateMeasurementUnits(
  _prev: UpdateMeasurementUnitsState,
  formData: FormData,
): Promise<UpdateMeasurementUnitsState> {
  const weight = formData.get("weight_display_unit");
  const temperature = formData.get("temperature_display_unit");
  const length = formData.get("length_display_unit");
  if (!isWeightDisplayUnit(weight) || !isTemperatureDisplayUnit(temperature) || !isLengthDisplayUnit(length)) {
    return { error: "Pick one option for each unit." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in to change this." };

  const { error } = await supabase
    .from("profiles")
    .update({ weight_display_unit: weight, temperature_display_unit: temperature, length_display_unit: length })
    .eq("id", user.id);
  if (error) return { error: "Couldn't save that. Please try again." };

  revalidatePath("/patient", "layout");
  return { success: true };
}
