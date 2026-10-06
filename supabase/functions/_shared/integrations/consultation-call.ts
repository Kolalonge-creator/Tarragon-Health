import type { LadderInput } from "./consultation-ladder.ts";
import type { ConnectionQuality } from "./video.ts";

/**
 * The pure half of the in-app call that the browser also runs (S21 follow-up, OQ-136): how the vendor SDK's connection signals become
 * ladder inputs. No vendor SDK, no clock and no crypto in here, so every rule is proved by tests and this file is safe to ship to the
 * page. Who may say they entered the room lives in participant-key.ts (server only).
 */

// ---- SDK signals to ladder inputs (pure) ----

/**
 * The SDK's connection-change state. `reconnecting` is a drop, `connected` after a drop is the return, `closed` is the call
 * ending (a person leaving or the host ending it), which is not a lost connection and starts no grace window, and `fail` is the
 * connection giving up for good.
 */
export function ladderInputFromConnection(state: unknown, atMs: number): LadderInput | "closed" | "failed" | null {
  const s = typeof state === "string" ? state.toLowerCase() : "";
  if (s === "reconnecting") return { kind: "lost", atMs };
  if (s === "connected") return { kind: "restored", atMs };
  if (s === "closed") return "closed";
  // `fail` is the SDK giving up on the connection: not the call ending, and no "back online" is coming, so the person goes to the phone.
  if (s === "fail") return "failed";
  return null;
}

/**
 * The SDK's network quality level, 0 to 5 (the vendor's own scale: poor is 0 or 1, normal is 2, good is 3 to 5). Anything
 * else is no reading. The SDK only reports it while the camera is on.
 */
export function qualityFromNetworkLevel(level: unknown): ConnectionQuality | null {
  if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > 5) return null;
  if (level <= 1) return "poor";
  return level === 2 ? "fair" : "good";
}

/** PROPOSED values: the `video.audio_fallback` entry of the proposed-config registry (v2). Never hard-code these. */
export interface AudioStatsPolicy {
  /** Average audio packet loss at or above this counts as poor. Percent, as the SDK reports it (unconfirmed, see OQ-136). */
  readonly poorAudioLossPercent: number;
  /** Audio round trip time at or above this, in milliseconds, counts as poor. */
  readonly poorAudioRttMs: number;
}

/**
 * Audio quality from the SDK's audio statistics, which keep arriving when the camera is off, so the ladder can still see the
 * link recover and offer video again. Either direction being poor makes the sample poor. No usable numbers is no reading.
 */
export function qualityFromAudioStats(data: unknown, policy: AudioStatsPolicy): ConnectionQuality | null {
  const d = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
  const loss = d?.["avg_loss"];
  const rtt = d?.["rtt"];
  const lossOk = typeof loss === "number" && Number.isFinite(loss);
  const rttOk = typeof rtt === "number" && Number.isFinite(rtt);
  if (!lossOk && !rttOk) return null;
  const poor = (lossOk && loss >= policy.poorAudioLossPercent) || (rttOk && rtt >= policy.poorAudioRttMs);
  return poor ? "poor" : "good";
}

const RANK: Record<ConnectionQuality, number> = { good: 0, fair: 1, poor: 2, lost: 3 };

/** The worse of two readings (an uplink and a downlink, or video and audio), so one bad direction is not hidden by a good one. */
export function worstQuality(a: ConnectionQuality, b: ConnectionQuality): ConnectionQuality {
  return RANK[a] >= RANK[b] ? a : b;
}

/** Statistics arrive every second or so; the ladder counts samples, so they are thinned to one per interval. */
export function isSampleDue(lastAtMs: number | null, atMs: number, intervalSeconds: number): boolean {
  return lastAtMs === null || atMs - lastAtMs >= intervalSeconds * 1000;
}
