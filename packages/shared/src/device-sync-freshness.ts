import { getProposedConfig } from "./proposed-config";

const LATEST = "9999-12-31";

/**
 * How long ago did a device or wearable last sync, and has it been quiet for long enough that the newest reading the person sees
 * may not be the latest one? Pure: no clock of its own, no I/O, so every branch is unit tested. Shared by the phone's device list and
 * the web wearable card, so the two say the same thing (the earlier phone list showed a bare date, which hides a three day gap).
 *
 * The threshold is PROPOSED configuration (devices.sync_freshness), never a literal. This decides wording only. It does not feed
 * any clinical rule: the rule engines already ignore readings outside their own windows (the titration protocol's windowDays, the
 * continuous glucose 30 minute rule, the pathway engine's 3 day rule), and a stale display must never change a grade.
 *
 * Message keys are returned, not text, so the wording lives in packages/i18n. A time the app cannot trust (unreadable, or in the
 * future by more than a few minutes because a clock moved) is "unknown", worded as cautiously as "behind".
 */
export type DeviceSyncMessageKey =
  | "devices.sync.never"
  | "devices.sync.unknown"
  | "devices.sync.just_now"
  | "devices.sync.minute_one"
  | "devices.sync.minute_other"
  | "devices.sync.hour_one"
  | "devices.sync.hour_other"
  | "devices.sync.day_one"
  | "devices.sync.day_other";

export type DeviceSyncLevel = "never" | "unknown" | "recent" | "behind";

export interface DeviceSyncFreshness {
  level: DeviceSyncLevel;
  /** Always present: when it last synced, in words (or that it has not, or cannot be told). */
  label: { key: DeviceSyncMessageKey; params?: { count: number } };
  /** True for "unknown" and "behind": the screen adds the calm note. A device never synced just says so (it may have just been paired). */
  showNote: boolean;
}

export interface DeviceSyncConfig {
  version: number;
  staleAfterMs: number;
}

/** A small clock difference between phone and server must not turn "just now" into "unknown". */
export const SYNC_CLOCK_SKEW_TOLERANCE_MS = 5 * 60_000;

export function loadDeviceSyncConfig(): DeviceSyncConfig {
  // The newest version, whatever the device clock says: a phone with a wrong or reset date must never throw while a screen renders (the
  // entry takes effect on a fixed date, and an earlier "today" would otherwise find no entry at all). This only sets display wording.
  const entry = getProposedConfig<{ readonly [k: string]: number }>("devices.sync_freshness", LATEST);
  const days = entry.value.stale_after_days;
  if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) throw new Error("devices.sync_freshness.stale_after_days is not a positive number");
  return { version: entry.version, staleAfterMs: days * 86_400_000 };
}

function agoKey(ageMs: number): DeviceSyncFreshness["label"] {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return { key: "devices.sync.just_now" };
  if (minutes < 60) return { key: minutes === 1 ? "devices.sync.minute_one" : "devices.sync.minute_other", params: { count: minutes } };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: hours === 1 ? "devices.sync.hour_one" : "devices.sync.hour_other", params: { count: hours } };
  const days = Math.floor(hours / 24);
  return { key: days === 1 ? "devices.sync.day_one" : "devices.sync.day_other", params: { count: days } };
}

export function assessDeviceSync(lastSyncedAt: string | null | undefined, nowMs: number, config: DeviceSyncConfig = loadDeviceSyncConfig()): DeviceSyncFreshness {
  if (lastSyncedAt === null || lastSyncedAt === undefined || lastSyncedAt === "") {
    return { level: "never", label: { key: "devices.sync.never" }, showNote: false };
  }
  const at = Date.parse(lastSyncedAt);
  if (!Number.isFinite(at) || !Number.isFinite(nowMs)) return { level: "unknown", label: { key: "devices.sync.unknown" }, showNote: true };
  const age = nowMs - at;
  if (age < -SYNC_CLOCK_SKEW_TOLERANCE_MS) return { level: "unknown", label: { key: "devices.sync.unknown" }, showNote: true };
  const ageMs = Math.max(0, age);
  return { level: ageMs >= config.staleAfterMs ? "behind" : "recent", label: agoKey(ageMs), showNote: ageMs >= config.staleAfterMs };
}
