import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PersonalBpTarget } from "./bp-trend-rules";
import { supabase } from "./supabase";

/**
 * The blood pressure target for the trends card. For her own account it asks the
 * server which target its alerts use (public.my_home_bp_target): the care team's,
 * or the standard starting target when none is set, labelled as such, so the card
 * never disagrees with an alert. While viewing someone else's account the
 * function does not apply (it answers only for the signed-in user), so only the
 * explicit patient_bp_targets row is read, as before; and if the function is not
 * on the server yet, the same explicit-row read is used. That read takes four
 * columns: the home target numbers, who set it (an id, never shown) and when; the
 * free-text rationale is not read.
 *
 * On the row path "confirmed" is decided by resolveTargetBand from `setBy` and
 * `setAt`, so a row with no clinician recorded is never presented as clinician-set.
 * When no target can be read the result is null and the card says none has been
 * set (or says nothing); it never invents one.
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

type Origin = NonNullable<PersonalBpTarget["origin"]>;

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

type ServerRow = { systolic: number | null; diastolic: number | null; source: string | null; set_at: string | null };

/**
 * The server's answer as a target. Only an attributed explicit target is the care team's;
 * "explicit_unattributed" (a row with no clinician recorded) and the derived ones are the
 * standard starting target, labelled as not set by the care team. An unknown source is
 * treated the same way, never as the care team's.
 */
export function toServerTarget(row: ServerRow | null | undefined): PersonalBpTarget | null {
  if (!row || typeof row.systolic !== "number" || typeof row.diastolic !== "number") return null;
  const origin: Origin = row.source === "explicit" ? "care_team" : "standard";
  return {
    systolicBelow: row.systolic,
    diastolicBelow: row.diastolic,
    setBy: null,
    setAt: origin === "care_team" ? row.set_at : null,
    origin,
  };
}

/** The function is simply not there yet (older server): PostgREST PGRST202, or Postgres undefined_function. */
function functionMissing(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST202" || error.code === "42883" || (/my_home_bp_target/.test(error.message ?? "") && /could not find|does not exist/i.test(error.message ?? ""));
}

/** The last target this phone saw for the account, with no network call (used by on-device triage, which must not wait). */
export async function readCachedBpTarget(userId: string, patientId: string): Promise<PersonalBpTarget | null> {
  return readCache(userId, patientId);
}

async function readCache(userId: string, patientId: string): Promise<PersonalBpTarget | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(userId, patientId));
    if (!raw) return null;
    const v = JSON.parse(raw) as { target?: PersonalBpTarget | null };
    const t = v.target;
    return t && typeof t.systolicBelow === "number" && typeof t.diastolicBelow === "number"
      ? {
          systolicBelow: t.systolicBelow,
          diastolicBelow: t.diastolicBelow,
          setBy: t.setBy ?? null,
          setAt: t.setAt ?? null,
          ...(t.origin === "care_team" || t.origin === "standard" ? { origin: t.origin } : {}),
        }
      : null;
  } catch {
    return null;
  }
}

export async function loadBpTarget(userId: string, patientId: string): Promise<BpTargetLoad> {
  try {
    if (userId === patientId) {
      const { data, error } = await supabase.rpc("my_home_bp_target");
      if (!error) {
        const target = toServerTarget(Array.isArray(data) ? data[0] : null);
        await AsyncStorage.setItem(cacheKey(userId, patientId), JSON.stringify({ target })).catch(() => {});
        return { target, fromCache: false };
      }
      // Any other failure (no signal, a server error) is not "the function is missing": use the copy on the phone.
      if (!functionMissing(error)) return { target: await readCache(userId, patientId), fromCache: true };
    }
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
