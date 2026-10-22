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

export interface StoredHomePins {
  /** The saved list, or null when the patient has never customised (or the layout is not theirs to read). */
  pins: string[] | null;
  /** True when the read itself failed: the patient may well have a saved layout we could not see. */
  readFailed: boolean;
}

/** The saved pin list for this patient. RLS limits this to their own row. */
export async function getStoredHomePins(patientId: string): Promise<StoredHomePins> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("patient_home_layout")
    .select("pinned")
    .eq("patient_id", patientId)
    .maybeSingle();
  // A failed read shows the defaults, but must be told apart from "never customised":
  // saving from a defaults view would overwrite a layout we simply could not read.
  if (error) return { pins: null, readFailed: true };
  return { pins: data?.pinned ?? null, readFailed: false };
}

export interface PinnedVitalValues {
  values: Partial<Record<HomeValuePinKey, HomePinVitalValue>>;
  /** Tiles whose read failed: shown as "couldn't load", never as "no reading yet". */
  failed: HomeValuePinKey[];
}

/**
 * Latest value for each pinned vitals tile that is not already in the summary stats.
 * Absent from the result means "no reading yet", so a tile never shows an invented number.
 */
export async function getPinnedVitalValues(
  patientId: string,
  pins: readonly HomePinKey[],
): Promise<PinnedVitalValues> {
  const wanted = pins.filter((key): key is HomeValuePinKey => isHomeValuePin(key) && !FROM_SUMMARY_STATS.includes(key));
  if (wanted.length === 0) return { values: {}, failed: [] };
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
      const { data, error } = await query.order("taken_at", { ascending: false }).limit(1);
      if (error) return [key, "failed"] as const;
      const row = data?.[0] as Record<string, unknown> | undefined;
      return [key, homePinVitalDisplay(key, row?.[column])] as const;
    }),
  );

  const values: Partial<Record<HomeValuePinKey, HomePinVitalValue>> = {};
  const failed: HomeValuePinKey[] = [];
  for (const [key, display] of entries) {
    if (display === "failed") failed.push(key);
    else if (display) values[key] = display;
  }
  return { values, failed };
}

