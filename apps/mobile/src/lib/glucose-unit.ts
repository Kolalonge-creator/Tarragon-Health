import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { DEFAULT_GLUCOSE_DISPLAY_UNIT, type GlucoseDisplayUnit } from "@tarragon/shared";

/**
 * The signed-in reader's glucose display unit — the native half of web's
 * GlucoseUnitProvider / getGlucoseDisplayUnit (see the column comment on
 * profiles.glucose_display_unit for why this exists at all).
 *
 * Deliberately the DEVICE OWNER's preference, not the subject's, matching
 * web's dashboard-context: this is how the person holding the phone reads a
 * number, not a fact about the body the reading came from. So it reads
 * auth.getUser() rather than taking a subjectId, and a supporter acting for a
 * relative still sees figures in their own unit.
 *
 * Cached in a module-level promise because several screens (Overview, Vitals,
 * Health Passport) ask for it independently on the same session, and this is
 * a value that changes only when the patient goes and changes it.
 */
let cached: Promise<GlucoseDisplayUnit> | null = null;

async function fetchUnit(): Promise<GlucoseDisplayUnit> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return DEFAULT_GLUCOSE_DISPLAY_UNIT;
    const { data } = await supabase
      .from("profiles")
      .select("glucose_display_unit")
      .eq("id", userId)
      .maybeSingle();
    return data?.glucose_display_unit === "mmol_l" ? "mmol_l" : DEFAULT_GLUCOSE_DISPLAY_UNIT;
  } catch {
    // A failed preference lookup must never be the reason a reading fails to
    // render, so this falls back rather than surfacing an error state.
    return DEFAULT_GLUCOSE_DISPLAY_UNIT;
  }
}

export function getGlucoseDisplayUnit(): Promise<GlucoseDisplayUnit> {
  if (!cached) cached = fetchUnit();
  return cached;
}

/** Call after the patient changes the setting, so the next read is not stale. */
export function clearGlucoseUnitCache(): void {
  cached = null;
}

export function useGlucoseDisplayUnit(): GlucoseDisplayUnit {
  const [unit, setUnit] = useState<GlucoseDisplayUnit>(DEFAULT_GLUCOSE_DISPLAY_UNIT);
  useEffect(() => {
    let active = true;
    void getGlucoseDisplayUnit().then((u) => {
      if (active) setUnit(u);
    });
    return () => {
      active = false;
    };
  }, []);
  return unit;
}
