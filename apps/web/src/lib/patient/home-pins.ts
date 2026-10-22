import { createClient } from "@/lib/supabase/server";
import {
  HOME_PIN_NEVER_FROM_WEARABLE,
  HOME_PIN_VITAL_COLUMN,
  HOME_PIN_VITAL_TYPE,
  homePinVitalDisplay,
  isHomeValuePin,
  type HomePinKey,
  type HomePinVitalValue,
  type HomeValuePinKey,
} from "@tarragon/shared";

/** Blood pressure and glucose already come from getPatientSummaryStats, in the reader's own unit. */
const FROM_SUMMARY_STATS: readonly HomePinKey[] = ["bp", "glucose"];

/** The saved pin list for this patient, or null when they have never customised. RLS limits this to their own row. */
export async function getStoredHomePins(patientId: string): Promise<string[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("patient_home_layout")
    .select("pinned")
    .eq("patient_id", patientId)
    .maybeSingle();
  // A failed read must not look like "show nothing"; fall back to the defaults.
  if (error || !data) return null;
  return data.pinned;
}

/**
 * Latest value for each pinned vitals tile that is not already in the summary stats.
 * Absent from the result means "no reading yet", so a tile never shows an invented number.
 */
export async function getPinnedVitalValues(
  patientId: string,
  pins: readonly HomePinKey[],
): Promise<Partial<Record<HomeValuePinKey, HomePinVitalValue>>> {
  const wanted = pins.filter((key): key is HomeValuePinKey => isHomeValuePin(key) && !FROM_SUMMARY_STATS.includes(key));
  if (wanted.length === 0) return {};
  const supabase = await createClient();

  const entries = await Promise.all(
    wanted.map(async (key) => {
      const column = HOME_PIN_VITAL_COLUMN[key];
      let query = supabase
        .from("vitals_readings")
        .select(column)
        .eq("patient_id", patientId)
        .eq("vital_type", HOME_PIN_VITAL_TYPE[key])
        .not(column, "is", null);
      if (HOME_PIN_NEVER_FROM_WEARABLE.includes(key)) query = query.neq("source", "wearable");
      const { data } = await query.order("taken_at", { ascending: false }).limit(1);
      const row = data?.[0] as Record<string, unknown> | undefined;
      return [key, homePinVitalDisplay(key, row?.[column])] as const;
    }),
  );

  const out: Partial<Record<HomeValuePinKey, HomePinVitalValue>> = {};
  for (const [key, display] of entries) {
    if (display) out[key] = display;
  }
  return out;
}

