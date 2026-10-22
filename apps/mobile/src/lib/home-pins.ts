import {
  HOME_PIN_NEVER_FROM_WEARABLE,
  HOME_PIN_VITAL_COLUMN,
  HOME_PIN_VITAL_TYPE,
  homePinVitalDisplay,
  isHomeValuePin,
  resolveHomePins,
  sanitizeHomePins,
  type HomePinKey,
  type HomePinLockContext,
  type HomePinVitalValue,
  type HomeValuePinKey,
} from "@tarragon/shared";
import type { QueryResult } from "./medications";
import { supabase } from "./supabase";

/** Blood pressure and glucose already come from getSummaryStats, in the reader's own unit. */
const FROM_SUMMARY_STATS: readonly HomePinKey[] = ["bp", "glucose"];

/**
 * The saved pin list, or null when the patient has never customised. RLS lets a
 * patient read only their own row, so for someone else's account this is null
 * and the defaults apply. A failed read is reported, not turned into "show nothing".
 */
export async function loadStoredHomePins(patientId: string): Promise<QueryResult<string[] | null>> {
  try {
    const { data, error } = await supabase
      .from("patient_home_layout")
      .select("pinned")
      .eq("patient_id", patientId)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: data?.pinned ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The vitals this patient's enrolled chronic programme(s) monitor; their pins stay on the home
 * screen. A failed read is reported so a save can refuse instead of guessing "none".
 */
export async function loadMonitoredVitals(patientId: string): Promise<QueryResult<string[]>> {
  try {
    const { data, error } = await supabase
      .from("chronic_programme_enrolments")
      .select("programme:chronic_condition_programmes(monitoring_vitals)")
      .eq("patient_id", patientId)
      .eq("status", "enrolled");
    if (error) return { ok: false, error: error.message };
    const vitals = new Set<string>();
    for (const row of data ?? []) {
      for (const v of row.programme?.monitoring_vitals ?? []) vitals.add(v);
    }
    return { ok: true, data: [...vitals] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Latest value for each pinned vitals tile that is not already in the summary stats. Absent means "no reading yet". */
export async function loadPinnedVitalValues(
  patientId: string,
  pins: readonly HomePinKey[],
): Promise<QueryResult<Partial<Record<HomeValuePinKey, HomePinVitalValue>>>> {
  const wanted = pins.filter((key): key is HomeValuePinKey => isHomeValuePin(key) && !FROM_SUMMARY_STATS.includes(key));
  if (wanted.length === 0) return { ok: true, data: {} };
  try {
    const rows = await Promise.all(
      wanted.map(async (key) => {
        const column = HOME_PIN_VITAL_COLUMN[key];
        let query = supabase
          .from("vitals_readings")
          .select(column)
          .eq("patient_id", patientId)
          .eq("vital_type", HOME_PIN_VITAL_TYPE[key])
          // A superseded or entered-in-error reading is never "the latest".
          .is("correction_status", null)
          .not(column, "is", null);
        if (HOME_PIN_NEVER_FROM_WEARABLE.includes(key)) query = query.neq("source", "wearable");
        const { data, error } = await query.order("taken_at", { ascending: false }).limit(1);
        if (error) throw new Error(error.message);
        const row = data?.[0] as Record<string, unknown> | undefined;
        return [key, homePinVitalDisplay(key, row?.[column])] as const;
      }),
    );
    const out: Partial<Record<HomeValuePinKey, HomePinVitalValue>> = {};
    for (const [key, display] of rows) {
      if (display) out[key] = display;
    }
    return { ok: true, data: out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Saves the signed-in patient's own pins, in order, against RLS. Anything that
 * must stay on (today's doses for anyone on a medication, the vitals their
 * programme monitors) is added back before saving. Returns the list that was actually saved.
 */
export async function saveHomePins(
  patientId: string,
  organisationId: string,
  pins: readonly HomePinKey[],
  lockContext: HomePinLockContext,
): Promise<QueryResult<HomePinKey[]>> {
  const toSave = resolveHomePins(sanitizeHomePins(pins), lockContext, []);
  try {
    const { error } = await supabase
      .from("patient_home_layout")
      .upsert({ patient_id: patientId, organisation_id: organisationId, pinned: toSave }, { onConflict: "patient_id" });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: toSave };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
