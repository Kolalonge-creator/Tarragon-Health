import {
  compactReadings,
  isRecord,
  numberFrom,
  reading,
  toIsoInstant,
  type NormalisedReading,
} from "../normalise";
import { authedGetJson, daySummaryInstant, path } from "./http";
import type { ProviderAdapter, WebhookNotification } from "./types";

/**
 * Oura — notify-then-fetch.
 *
 * Webhook body is `{event_type, data_type, object_id, user_id, event_time}`:
 * `data_type` names the v2 usercollection the document belongs to and
 * `object_id` is its document id, so the follow-up read is a single GET at
 * `/v2/usercollection/{data_type}/{object_id}`. No measurements inline.
 *
 * `delete` events are ignored rather than acted on: the platform's readings
 * are an append-only clinical record, and a patient tidying up their Oura
 * account should not silently remove data a clinician may already have
 * reviewed. Removing a reading is a care-team action, not a webhook side
 * effect.
 *
 * CAVEAT: written against Oura's documented v2 API, not verified against a
 * live subscription.
 */

const API = "https://api.ouraring.com/v2/usercollection";

/** The data_types worth reading. Anything else (tags, workouts, sessions)
 * has no home on this platform yet and is skipped rather than guessed at. */
const SUPPORTED_DATA_TYPES = new Set([
  "daily_activity",
  "daily_readiness",
  "daily_spo2",
  "sleep",
]);

export const ouraAdapter: ProviderAdapter = {
  parseNotifications(body: unknown): WebhookNotification[] {
    if (!isRecord(body)) return [];
    const userId = body.user_id;
    const dataType = body.data_type;
    const objectId = body.object_id;
    const eventType = body.event_type;
    if (typeof userId !== "string" || typeof dataType !== "string") return [];
    if (typeof objectId !== "string" && typeof objectId !== "number") return [];
    if (eventType === "delete") return [];
    if (!SUPPORTED_DATA_TYPES.has(dataType)) return [];
    return [{ externalId: userId, target: { dataType, objectId: String(objectId) } }];
  },

  async fetchForNotification(
    accessToken: string,
    notification: WebhookNotification
  ): Promise<NormalisedReading[]> {
    const { dataType, objectId } = notification.target;
    const json = await authedGetJson(`${API}/${dataType}/${objectId}`, accessToken);
    if (json === null) return [];

    const prefix = `oura:${dataType}:${objectId}`;
    // Daily documents are keyed by `day` and describe a whole calendar day;
    // a sleep document has real start/end timestamps.
    const day = path(json, "day");
    const dayInstant = typeof day === "string" ? daySummaryInstant(day) : null;

    if (dataType === "daily_activity") {
      return compactReadings([
        reading("steps", numberFrom(path(json, "steps")), "steps", dayInstant, prefix),
        reading(
          "calories",
          numberFrom(path(json, "total_calories")) ?? numberFrom(path(json, "active_calories")),
          "kcal",
          dayInstant,
          prefix
        ),
      ]);
    }

    if (dataType === "daily_readiness") {
      return compactReadings([
        reading("readiness_score", numberFrom(path(json, "score")), "score", dayInstant, prefix),
      ]);
    }

    if (dataType === "daily_spo2") {
      return compactReadings([
        reading(
          "spo2",
          numberFrom(path(json, "spo2_percentage", "average")),
          "%",
          dayInstant,
          prefix
        ),
      ]);
    }

    if (dataType === "sleep") {
      const instant =
        toIsoInstant(path(json, "bedtime_end")) ?? dayInstant ?? toIsoInstant(path(json, "bedtime_start"));
      const totalSeconds = numberFrom(path(json, "total_sleep_duration"));
      return compactReadings([
        reading(
          "sleep_minutes",
          totalSeconds === null ? null : Math.round(totalSeconds / 60),
          "min",
          instant,
          prefix
        ),
        reading("sleep_efficiency", numberFrom(path(json, "efficiency")), "%", instant, prefix),
        reading("hrv_ms", numberFrom(path(json, "average_hrv")), "ms", instant, prefix),
        // Oura's lowest overnight heart rate is the closest analogue it has
        // to a resting heart rate; `average_heart_rate` over a night in bed
        // is not the same measurement a clinician means by "resting pulse".
        reading(
          "resting_heart_rate",
          numberFrom(path(json, "lowest_heart_rate")),
          "bpm",
          instant,
          prefix
        ),
        reading(
          "respiratory_rate",
          numberFrom(path(json, "average_breath")),
          "breaths/min",
          instant,
          prefix
        ),
      ]);
    }

    return [];
  },
};
