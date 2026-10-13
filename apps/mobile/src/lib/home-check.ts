import AsyncStorage from "@react-native-async-storage/async-storage";
import { assessHomeCheck, parseHomeBpConfig, type HomeBpConfig, type HomeBpReading, type HomeCheckAssessment } from "@tarragon/clinical";
import { getProposedConfig } from "@tarragon/shared";
import { lagosLocalDate } from "./lagos-date";
import { supabase } from "./supabase";
import { loadRecentBpReadings } from "./vitals";
import {
  buildHomeCheckView,
  outcomeForError,
  parseCompleteResult,
  type HomeCheckView,
  type StoredHomeCheck,
  type SubmitOutcome,
} from "./home-check-model";

/**
 * The seven-day home check on the phone (S07x). Offline first: the protocol, the readings and the progress all come from this phone
 * (`loadRecentBpReadings` reads the offline mirror and the outbox), so nothing here needs a network to show or to count. The only network call is the
 * patient's own "send my results", which the server answers with the recorded average (the server recounts from the stored readings and never trusts a
 * number from the phone). If it cannot be reached the request is kept and retried next time the card loads; "with your care team" is shown only after the
 * server says so.
 *
 * Every number comes from the versioned configuration `bp.home_programme` through @tarragon/clinical. They ship inside the app (as the other S07 values do),
 * so a change reaches installed phones only with the next build or update; the server always uses the signed row.
 *
 * Whether the card appears at all follows the server's `home_bp_programme` go-live guard (INV-14). The last answer is remembered per account so an
 * offline phone keeps behaving the way it last knew; a phone that has never learned it shows nothing.
 */
const GUARD_KEY = "home_bp_programme";
const storeKey = (patientId: string) => `@tarragon/home-check/v1:${patientId}`;
const guardKey = (patientId: string) => `@tarragon/home-check-guard/v1:${patientId}`;

let cachedConfig: HomeBpConfig | null = null;
export function loadHomeBpConfig(): HomeBpConfig {
  if (!cachedConfig) {
    const entry = getProposedConfig("bp.home_programme");
    cachedConfig = parseHomeBpConfig(entry.version, entry.value);
  }
  return cachedConfig;
}

export async function readStored(patientId: string): Promise<StoredHomeCheck | null> {
  try {
    const raw = await AsyncStorage.getItem(storeKey(patientId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StoredHomeCheck>;
    if (typeof v.startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.startDate)) return null;
    return v as StoredHomeCheck;
  } catch {
    return null;
  }
}

async function writeStored(patientId: string, value: StoredHomeCheck | null): Promise<void> {
  try {
    if (value === null) await AsyncStorage.removeItem(storeKey(patientId));
    else await AsyncStorage.setItem(storeKey(patientId), JSON.stringify(value));
  } catch {
    // Storage can fail on a full phone; the card then starts over, it never blocks logging a reading.
  }
}

/** The server's guard answer, remembered. Null when it has never been learned. */
export async function readGuardOpen(patientId: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.rpc("go_live_guard_is_open", { p_key: GUARD_KEY });
    if (!error && typeof data === "boolean") {
      await AsyncStorage.setItem(guardKey(patientId), String(data)).catch(() => undefined);
      return data;
    }
  } catch {
    // fall through to the remembered answer
  }
  try {
    const remembered = await AsyncStorage.getItem(guardKey(patientId));
    return remembered === "true" ? true : remembered === "false" ? false : null;
  } catch {
    return null;
  }
}

function toHomeReadings(list: readonly { systolic: number; diastolic: number; takenAt: string }[]): HomeBpReading[] {
  return list
    .map((r) => ({ systolic: r.systolic, diastolic: r.diastolic, atMs: Date.parse(r.takenAt) }))
    .filter((r) => Number.isFinite(r.atMs));
}

export interface HomeCheckLoad {
  view: HomeCheckView;
  assessment: HomeCheckAssessment | null;
}

/** Everything the card needs, from this phone. Sends a pending request first if one is waiting. */
export async function loadHomeCheck(patientId: string, nowMs: number): Promise<HomeCheckLoad> {
  // The server acts for the signed-in person only, so the card is for her own account, never one she is viewing on someone's behalf.
  const session = await supabase.auth.getSession().catch(() => null);
  if (session?.data.session?.user.id !== patientId) return { view: { kind: "hidden" }, assessment: null };
  const guardOpen = await readGuardOpen(patientId);
  let stored = await readStored(patientId);
  if (guardOpen !== true) return { view: buildHomeCheckView({ guardOpen, stored: null, assessment: null }), assessment: null };
  const cfg = loadHomeBpConfig();
  let assessment: HomeCheckAssessment | null = null;
  if (stored && !stored.submittedAt) {
    // A 7-day window holds at most 4 readings a day, plus a few extra: 80 is far above anything the protocol produces.
    const readings = toHomeReadings(await loadRecentBpReadings(patientId, 80).catch(() => []));
    assessment = assessHomeCheck({ readings, startDate: stored.startDate, nowMs }, cfg);
    if (stored.sendRequestedAt && assessment.complete) {
      const outcome = await submit(patientId, stored);
      if (outcome.kind === "recorded") stored = (await readStored(patientId)) ?? stored;
    }
  }
  return { view: buildHomeCheckView({ guardOpen, stored, assessment }), assessment };
}

export async function startHomeCheck(patientId: string, nowMs: number): Promise<void> {
  await writeStored(patientId, { startDate: lagosLocalDate(nowMs) });
}

export async function clearHomeCheck(patientId: string): Promise<void> {
  await writeStored(patientId, null);
}

async function submit(patientId: string, stored: StoredHomeCheck): Promise<SubmitOutcome> {
  try {
    const { data, error } = await supabase.rpc("complete_home_bp_check", { p_window_start: stored.startDate });
    if (error) return outcomeForError(error);
    const outcome = parseCompleteResult(data);
    if (!outcome) return { kind: "offline" };
    if (outcome.kind === "recorded") {
      await writeStored(patientId, { ...stored, submittedAt: new Date().toISOString(), result: outcome.result });
    }
    return outcome;
  } catch {
    return { kind: "offline" };
  }
}

/**
 * The patient taps "send". The request is saved first (so it survives an offline phone), then one attempt is made. Anything but a recorded answer leaves
 * the request in place and it is retried the next time the card loads.
 */
export async function requestSend(patientId: string): Promise<SubmitOutcome> {
  const stored = await readStored(patientId);
  if (!stored) return { kind: "offline" };
  const withRequest: StoredHomeCheck = { ...stored, sendRequestedAt: stored.sendRequestedAt ?? new Date().toISOString() };
  await writeStored(patientId, withRequest);
  return submit(patientId, withRequest);
}
