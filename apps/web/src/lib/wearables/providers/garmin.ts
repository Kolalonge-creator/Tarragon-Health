import {
  compactReadings,
  isRecord,
  numberFrom,
  reading,
  type NormalisedReading,
} from "../normalise";
import { daySummaryInstant } from "./http";
import type { InlineReadingGroup, ProviderAdapter } from "./types";

/**
 * Garmin — inline push, the odd one out.
 *
 * Garmin's Health API pushes the summaries themselves in the webhook body
 * (`{"dailies": [...], "sleeps": [...], "bodyComps": [...], "pulseOx": [...]}`),
 * so there is no follow-up fetch and no access token needed at ingestion
 * time. Each summary carries its own `userId`, and one POST may legitimately
 * contain summaries for several different users — which is why this returns
 * readings grouped by account rather than a flat list.
 *
 * IMPORTANT — Garmin has two integration modes and only one works here.
 * A "Push" registration delivers the summaries inline, which is what this
 * adapter reads. A "Ping/Pull" registration instead delivers
 * `{"dailies":[{"userId":..., "callbackURL":"..."}]}` and expects the
 * consumer to call that callbackURL with an OAuth-signed request. Under
 * Ping/Pull this adapter would find no measurements and silently ingest
 * nothing, so `isPingPullPayload` detects that shape explicitly and the
 * caller surfaces it as an unsupported configuration rather than a quiet
 * zero. If Garmin is ever registered as Ping/Pull, the fix is a real pull
 * implementation (and Garmin's Health API signs with OAuth 1.0a, which the
 * shared OAuth2 token-exchange module does not model — see its own caveat).
 *
 * CAVEAT: written against Garmin's documented Health API push payloads, not
 * verified against a live push configuration.
 */

export const garminAdapter: ProviderAdapter = {
  readInline(body: unknown): InlineReadingGroup[] {
    if (!isRecord(body)) return [];
    const byUser = new Map<string, NormalisedReading[]>();

    const add = (userId: string, readings: NormalisedReading[]) => {
      if (readings.length === 0) return;
      const existing = byUser.get(userId);
      if (existing) existing.push(...readings);
      else byUser.set(userId, [...readings]);
    };

    for (const summary of arrayAt(body, "dailies")) {
      const context = summaryContext(summary);
      if (!context) continue;
      add(
        context.userId,
        compactReadings([
          reading("steps", numberFrom(summary.steps), "steps", context.instant, context.prefix),
          reading(
            "resting_heart_rate",
            numberFrom(summary.restingHeartRateInBeatsPerMinute) ?? numberFrom(summary.restingHeartRate),
            "bpm",
            context.instant,
            context.prefix
          ),
          reading(
            "calories",
            numberFrom(summary.activeKilocalories),
            "kcal",
            context.instant,
            context.prefix
          ),
        ])
      );
    }

    for (const summary of arrayAt(body, "sleeps")) {
      const context = summaryContext(summary);
      if (!context) continue;
      const durationSeconds = numberFrom(summary.durationInSeconds);
      add(
        context.userId,
        compactReadings([
          reading(
            "sleep_minutes",
            durationSeconds === null ? null : Math.round(durationSeconds / 60),
            "min",
            context.instant,
            context.prefix
          ),
        ])
      );
    }

    for (const summary of arrayAt(body, "bodyComps")) {
      const context = summaryContext(summary);
      if (!context) continue;
      const grams = numberFrom(summary.weightInGrams);
      add(
        context.userId,
        compactReadings([
          reading(
            "weight",
            grams === null ? null : grams / 1000,
            "kg",
            context.instant,
            context.prefix
          ),
        ])
      );
    }

    // Garmin is inconsistent about the casing of this one across its own
    // docs and portal, so both spellings are read rather than betting on one.
    for (const summary of [...arrayAt(body, "pulseOx"), ...arrayAt(body, "pulseox")]) {
      const context = summaryContext(summary);
      if (!context) continue;
      add(
        context.userId,
        compactReadings([
          reading("spo2", averageSpo2(summary), "%", context.instant, context.prefix),
        ])
      );
    }

    // Blood pressure is a first-class Garmin summary type and the platform's
    // core vital, so it is worth reading even though most Garmin wearables
    // never produce it (it comes from a paired Index BPM cuff).
    for (const summary of arrayAt(body, "bloodPressures")) {
      const context = summaryContext(summary);
      if (!context) continue;
      const systolic = numberFrom(summary.systolic);
      const diastolic = numberFrom(summary.diastolic);
      if (systolic === null || diastolic === null) continue;
      const bp = reading("blood_pressure", systolic, "mmHg", context.instant, context.prefix);
      if (bp) add(context.userId, [{ ...bp, secondaryValue: Math.round(diastolic) }]);
    }

    return [...byUser.entries()].map(([externalId, readings]) => ({ externalId, readings }));
  },
};

/**
 * True when Garmin is delivering Ping/Pull notifications (an account plus a
 * callbackURL to go and fetch) rather than Push summaries. Distinguishing
 * this matters because both shapes are structurally valid JSON with the same
 * top-level keys — without the check, a misregistered integration looks
 * exactly like a user with no data.
 */
export function isGarminPingPullPayload(body: unknown): boolean {
  if (!isRecord(body)) return false;
  return Object.values(body).some(
    (value) =>
      Array.isArray(value) &&
      value.some((entry) => isRecord(entry) && typeof entry.callbackURL === "string")
  );
}

function arrayAt(body: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = body[key];
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

interface SummaryContext {
  userId: string;
  instant: string | null;
  prefix: string;
}

function summaryContext(summary: Record<string, unknown>): SummaryContext | null {
  const userId = summary.userId;
  if (typeof userId !== "string") return null;

  // startTimeInSeconds is a real UTC epoch and is preferred; calendarDate is
  // the fallback for summaries that only describe a whole day.
  const startSeconds = numberFrom(summary.startTimeInSeconds);
  const calendarDate = typeof summary.calendarDate === "string" ? summary.calendarDate : null;
  const instant =
    startSeconds !== null
      ? new Date(startSeconds * 1000).toISOString()
      : calendarDate
        ? daySummaryInstant(calendarDate)
        : null;

  const summaryId = typeof summary.summaryId === "string" ? summary.summaryId : null;
  if (!summaryId && !calendarDate) return null;

  return { userId, instant, prefix: `garmin:${summaryId ?? calendarDate}` };
}

/** Garmin's Pulse Ox summary reports a map of second-offset -> SpO2 rather
 * than a single figure; the daily average is the comparable number. */
function averageSpo2(summary: Record<string, unknown>): number | null {
  const direct = numberFrom(summary.averageSpo2) ?? numberFrom(summary.spo2Value);
  if (direct !== null) return direct;

  const values = summary.timeOffsetSpo2Values;
  if (!isRecord(values)) return null;
  const numbers = Object.values(values)
    .map(numberFrom)
    .filter((value): value is number => value !== null);
  if (numbers.length === 0) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}
