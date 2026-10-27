import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { DEFAULT_MEASUREMENT_UNITS, measurementUnitsFromProfile, type MeasurementUnits } from "@tarragon/shared";

/**
 * The signed-in reader's weight, temperature and length display units: the native half of web's
 * MeasurementUnitsProvider. Like the glucose unit it is the DEVICE OWNER's preference, cached per session, and a failed
 * lookup falls back to metric rather than becoming the reason a reading fails to render.
 */
let cached: Promise<MeasurementUnits> | null = null;

async function fetchUnits(): Promise<MeasurementUnits> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return DEFAULT_MEASUREMENT_UNITS;
    const { data } = await supabase
      .from("profiles")
      .select("weight_display_unit, temperature_display_unit, length_display_unit")
      .eq("id", userId)
      .maybeSingle();
    return measurementUnitsFromProfile(data);
  } catch {
    // Do not keep a failed lookup: the next read should try again rather than stay on metric for the whole session.
    cached = null;
    return DEFAULT_MEASUREMENT_UNITS;
  }
}

/** The cache belongs to one signed-in person; a different account must not inherit their units. */
supabase.auth?.onAuthStateChange?.((event) => {
  if (event === "SIGNED_OUT" || event === "SIGNED_IN") cached = null;
});

export function getMeasurementUnits(): Promise<MeasurementUnits> {
  if (!cached) cached = fetchUnits();
  return cached;
}

/** Call after the patient changes the setting, so the next read is not stale. */
export function clearMeasurementUnitsCache(): void {
  cached = null;
}

export function useMeasurementUnits(): MeasurementUnits {
  const [units, setUnits] = useState<MeasurementUnits>(DEFAULT_MEASUREMENT_UNITS);
  useEffect(() => {
    let active = true;
    void getMeasurementUnits().then((u) => {
      if (active) setUnits(u);
    });
    return () => {
      active = false;
    };
  }, []);
  return units;
}
