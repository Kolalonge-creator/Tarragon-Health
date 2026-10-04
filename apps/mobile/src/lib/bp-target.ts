import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PersonalBpTarget } from "./bp-trend-rules";
import { supabase } from "./supabase";

/**
 * The patient's own blood pressure target as her care team set it (the
 * patient_bp_targets row), for the trends card. Only the four columns the card
 * needs are read: the home target numbers, who set it (an id, never shown) and
 * when. The free-text rationale is not read.
 *
 * "Confirmed" is decided by resolveTargetBand from `setBy` and `setAt`, so a row
 * with no clinician recorded is never presented as clinician-set. When there is
 * no row, or the row cannot be read (for example while she is viewing someone
 * else's account, which her access does not cover), the result is null and the
 * card says no target has been set; it never invents one.
 *
 * The last good answer is kept on the phone per account and subject, so the
 * card still shows her target with no signal. A failed read falls back to it.
 */
export interface BpTargetLoad {
  target: PersonalBpTarget | null;
  /** True when the answer came from the copy on the phone because the server could not be reached. */
  fromCache: boolean;
}

const cacheKey = (userId: string, patientId: string) => `@tarragon/bp-target/v1:${userId}:${patientId}`;

type Row = { home_systolic: number | null; home_diastolic: number | null; set_by: string | null; updated_at: string | null };

export function toTarget(row: Row | null): PersonalBpTarget | null {
  if (!row || typeof row.home_systolic !== "number" || typeof row.home_diastolic !== "number") return null;
  return {
    systolicBelow: row.home_systolic,
    diastolicBelow: row.home_diastolic,
    setBy: row.set_by,
    setAt: row.updated_at,
  };
}

async function readCache(userId: string, patientId: string): Promise<PersonalBpTarget | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(userId, patientId));
    if (!raw) return null;
    const v = JSON.parse(raw) as { target?: PersonalBpTarget | null };
    const t = v.target;
    return t && typeof t.systolicBelow === "number" && typeof t.diastolicBelow === "number"
      ? { systolicBelow: t.systolicBelow, diastolicBelow: t.diastolicBelow, setBy: t.setBy ?? null, setAt: t.setAt ?? null }
      : null;
  } catch {
    return null;
  }
}

export async function loadBpTarget(userId: string, patientId: string): Promise<BpTargetLoad> {
  try {
    const { data, error } = await supabase
      .from("patient_bp_targets")
      .select("home_systolic, home_diastolic, set_by, updated_at")
      .eq("patient_id", patientId)
      .maybeSingle();
    if (!error) {
      const target = toTarget(data);
      // An empty answer is remembered too, so a target the care team removed does not linger.
      await AsyncStorage.setItem(cacheKey(userId, patientId), JSON.stringify({ target })).catch(() => {});
      return { target, fromCache: false };
    }
  } catch {
    // fall through to the copy on the phone
  }
  return { target: await readCache(userId, patientId), fromCache: true };
}
