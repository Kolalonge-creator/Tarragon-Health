import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  buildToday,
  computeReadiness,
  parseHomeCardConfig,
  parseReadinessConfig,
  type ReadinessResult,
  type TimedValue,
  type TodayFacts,
  type TodayPlan,
} from "@tarragon/clinical/today";
import { getWeeklyCards, postTodayBuild } from "./api";
import { lagosLocalDate } from "./lagos-date";
import { loadWeeklyLesson } from "./learning-centre";
import { loadActivityState } from "./lifestyle-trackers";
import { doneDatesFrom, buildFacts, withFreeze } from "./home-plan-model";
import { supabase } from "./supabase";
import { computeStreak, type StreakState } from "./streaks";
import { loadStreakRules } from "./s07-config";
import { loadToday, type TodayLoad } from "./today";
import { loadRecentBpReadings } from "./vitals";

/**
 * The S47b Today plan on the phone: reads the signed configuration, gathers the facts, and runs `today-build` here (offline first). If the phone cannot
 * run it, the same facts go to `/api/mobile/today-build` and the server answers with the same plan.
 *
 * Returns null (the screen then keeps today's ordinary Today list) when the configuration is not signed, cannot be read, or nothing can be built. The
 * last signed configuration is remembered per account so a phone with no signal keeps behaving the way it last knew; a phone that has never learned
 * one shows the ordinary list (fail closed).
 */
export interface WeeklyCardLines {
  cards: { code: string; state: "ready" | "not_enough"; title: { key: string; params?: Record<string, string | number> }; line: { key: string; params?: Record<string, string | number> } }[];
}

export interface HomePlan {
  plan: TodayPlan;
  today: TodayLoad;
  streak: StreakState | null;
  readiness: ReadinessResult;
  weekly: WeeklyCardLines | null;
}

const configKey = (userId: string) => `@tarragon/home-card-config/v1:${userId}`;
const freezeKey = (patientId: string) => `@tarragon/streak-freezes/v1:${patientId}`;
const DAY_MS = 86_400_000;

export async function loadHomeCardConfig(userId: string): Promise<{ version: number; config: Record<string, unknown> } | null> {
  try {
    const { data, error } = await supabase.rpc("my_home_card_config");
    if (!error) {
      const row = data as { version?: unknown; config?: unknown } | null;
      const ok = row && typeof row.version === "number" && typeof row.config === "object" && row.config !== null ? (row as { version: number; config: Record<string, unknown> }) : null;
      // An unsigned or withdrawn configuration is remembered as "none", so a phone never keeps showing cards the CMO has not signed.
      await AsyncStorage.setItem(configKey(userId), JSON.stringify(ok)).catch(() => undefined);
      return ok;
    }
  } catch {
    // fall through to the remembered answer
  }
  try {
    const raw = await AsyncStorage.getItem(configKey(userId));
    return raw ? (JSON.parse(raw) as { version: number; config: Record<string, unknown> } | null) : null;
  } catch {
    return null;
  }
}

async function readFreezes(patientId: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(freezeKey(patientId));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function loadLoggedDates(patientId: string, nowMs: number): Promise<string[]> {
  try {
    const since = new Date(nowMs - 120 * DAY_MS).toISOString();
    const { data, error } = await supabase.from("vitals_readings").select("taken_at").eq("patient_id", patientId).is("correction_status", null).gte("taken_at", since).order("taken_at", { ascending: false }).limit(2000);
    if (!error && data) return doneDatesFrom(data.map((r) => r.taken_at));
  } catch {
    // fall through to the blood pressure copy kept on the phone
  }
  const bp = await loadRecentBpReadings(patientId, 200).catch(() => []);
  return doneDatesFrom(bp.map((r) => r.takenAt));
}

async function loadStreak(patientId: string, nowMs: number): Promise<StreakState> {
  const [dates, freezes] = await Promise.all([loadLoggedDates(patientId, nowMs), readFreezes(patientId)]);
  const state = computeStreak({
    doneDates: dates,
    events: freezes.map((localDate) => ({ localDate, kind: "freeze" as const })),
    todayLocal: lagosLocalDate(nowMs),
    rules: loadStreakRules(),
  });
  // The caller contract of computeStreak: a proposed freeze must be written before the Lagos day rolls over, or the run resets.
  if (state.proposedFreezeDate) {
    await AsyncStorage.setItem(freezeKey(patientId), JSON.stringify(withFreeze(freezes, state.proposedFreezeDate))).catch(() => undefined);
  }
  return state;
}

/** Wearable data already stored for this person. Nothing is read for someone with no connected device. */
async function loadReadiness(patientId: string, nowMs: number, raw: unknown, hasDevice: boolean): Promise<ReadinessResult> {
  let cfg;
  try {
    cfg = parseReadinessConfig(raw);
  } catch {
    return { kind: "none", reason: "switched_off" };
  }
  if (!hasDevice) return computeReadiness(cfg, { nowMs, hasDevice: false, sleepMinutes: [], hrvMs: [], restingHr: [] });
  const since = new Date(nowMs - (cfg.baselineDays + 2) * DAY_MS).toISOString();
  try {
    const [wearable, pulse] = await Promise.all([
      supabase.from("wearable_readings").select("reading_type, value, recorded_at").in("reading_type", ["sleep_minutes", "hrv_ms"]).gte("recorded_at", since).order("recorded_at", { ascending: false }).limit(500),
      supabase.from("vitals_readings").select("pulse_bpm, taken_at").eq("patient_id", patientId).eq("vital_type", "pulse").eq("source", "wearable").is("correction_status", null).gte("taken_at", since).order("taken_at", { ascending: false }).limit(500),
    ]);
    if (wearable.error || pulse.error) return { kind: "none", reason: "no_recent_data" };
    const series = (type: string): TimedValue[] =>
      (wearable.data ?? []).flatMap((r) => (r.reading_type === type && typeof r.value === "number" ? [{ atMs: Date.parse(r.recorded_at), value: r.value }] : []));
    const resting: TimedValue[] = (pulse.data ?? []).flatMap((r) => (typeof r.pulse_bpm === "number" ? [{ atMs: Date.parse(r.taken_at), value: r.pulse_bpm }] : []));
    return computeReadiness(cfg, { nowMs, hasDevice: true, sleepMinutes: series("sleep_minutes"), hrvMs: series("hrv_ms"), restingHr: resting });
  } catch {
    return { kind: "none", reason: "no_recent_data" };
  }
}

async function hasConnectedDevice(patientId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.from("wearable_connections").select("id").eq("patient_id", patientId).eq("status", "active").limit(1);
    return !error && (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

function asWeekly(data: unknown): WeeklyCardLines | null {
  const d = data as { state?: unknown; summary?: { cards?: unknown } } | null;
  if (!d || d.state !== "ready" || !Array.isArray(d.summary?.cards) || d.summary.cards.length === 0) return null;
  return { cards: d.summary.cards as WeeklyCardLines["cards"] };
}

export async function loadHomePlan(userId: string, patientId: string, nowMs: number = Date.now()): Promise<HomePlan | null> {
  // The plan is for the signed-in person's own account; another person's account keeps the ordinary list.
  if (userId !== patientId) return null;
  const stored = await loadHomeCardConfig(userId);
  if (!stored) return null;
  // A configuration this build cannot read (for example a card this app version does not know yet, signed after the app was released) is not an
  // error: the server runs the same function over the same signed row, so the phone asks it instead of showing a wrong or empty plan.
  let config: ReturnType<typeof parseHomeCardConfig> | null = null;
  try {
    config = parseHomeCardConfig(stored.version, stored.config);
  } catch {
    config = null;
  }

  const [today, hasDevice, activity, lesson, weeklyRaw] = await Promise.all([
    loadToday(patientId, nowMs),
    hasConnectedDevice(patientId),
    loadActivityState(patientId).catch(() => null),
    loadWeeklyLesson().catch(() => null),
    getWeeklyCards().catch(() => null),
  ]);
  const weekly = asWeekly(weeklyRaw);
  const streak = !config || config.streakEnabled ? await loadStreak(patientId, nowMs).catch(() => null) : null;
  const readiness = await loadReadiness(patientId, nowMs, stored.config["readiness"], hasDevice);

  const facts: TodayFacts = buildFacts({
    today,
    hasDevice,
    activityWeek: activity && activity.ok && activity.data.week ? { activeMinutes: activity.data.week.activeMinutes, goalMinutes: activity.data.week.goalMinutes } : null,
    lessonAvailable: lesson !== null,
    streakAvailable: streak !== null,
    weeklyAvailable: weekly !== null,
    readinessAvailable: readiness.kind === "band",
  });

  let plan: TodayPlan | null = null;
  if (config) {
    plan = buildToday(config, facts);
  } else {
    const answer = (await postTodayBuild(facts).catch(() => null)) as { state?: string; plan?: TodayPlan } | null;
    plan = answer?.state === "ready" && answer.plan ? answer.plan : null;
  }
  return plan ? { plan, today, streak, readiness, weekly } : null;
}
