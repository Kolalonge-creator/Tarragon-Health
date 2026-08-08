import {
  compactReadings,
  isRecord,
  numberFrom,
  reading,
  toIsoInstant,
  type NormalisedReading,
} from "../normalise";
import { authedGetJson, path } from "./http";
import type { ProviderAdapter, WebhookNotification } from "./types";

/**
 * WHOOP — notify-then-fetch.
 *
 * Webhook body is a single event: `{user_id, id, type, trace_id}` where
 * `type` is `recovery.updated` / `sleep.updated` / `workout.updated` and `id`
 * identifies the document that changed. No measurements are included, so
 * every value below comes from the follow-up authenticated GET.
 *
 * `user_id` is a number in WHOOP's payload but wearable_connections.external_id
 * is text, so it is stringified here — the token exchange stores the same
 * value the same way.
 *
 * VERSION: v2, and that is not cosmetic. WHOOP removed v1 and its endpoints
 * now return 404, so a v1 path would have quietly ingested nothing forever
 * while looking perfectly healthy — the webhook would authenticate, resolve
 * a connection, fetch nothing and ack 200. v2 also changed identifiers:
 * sleep and workout ids became UUIDs, and a recovery webhook now carries the
 * UUID of the *sleep* a recovery belongs to rather than a cycle id, which is
 * why fetchRecovery below is a collection lookup and not a direct GET.
 *
 * Field names are taken from WHOOP's published v2 schema, not from a live
 * subscription — no developer app exists yet. `hrv_rmssd_milli` is
 * milliseconds, per WHOOP's own documented example value of 31.813562.
 */

const API = "https://api.prod.whoop.com/developer/v2";

export const whoopAdapter: ProviderAdapter = {
  parseNotifications(body: unknown): WebhookNotification[] {
    if (!isRecord(body)) return [];
    const userId = body.user_id;
    const id = body.id;
    const type = body.type;
    if (typeof type !== "string") return [];
    if (typeof userId !== "string" && typeof userId !== "number") return [];
    if (typeof id !== "string" && typeof id !== "number") return [];
    return [{ externalId: String(userId), target: { type, id: String(id) } }];
  },

  async fetchForNotification(
    accessToken: string,
    notification: WebhookNotification
  ): Promise<NormalisedReading[]> {
    const { type, id } = notification.target;
    // `.deleted` events are ignored on purpose, matching the Oura adapter:
    // readings are an append-only clinical record, and a patient tidying up
    // their WHOOP account must not silently remove data a clinician may have
    // already reviewed. Removing a reading is a care-team action.
    if (type === "recovery.updated") return fetchRecovery(accessToken, id);
    if (type === "sleep.updated") return fetchSleep(accessToken, id);
    if (type === "workout.updated") return fetchWorkout(accessToken, id);
    return [];
  },
};

/**
 * v2 has no "get recovery by id" route — recovery hangs off a cycle
 * (`/v2/cycle/{cycleId}/recovery`), while the webhook hands over the UUID of
 * the associated *sleep*. So the recovery is found by reading the recent
 * recovery collection and matching on `sleep_id`. The page is small because
 * a webhook fires when the recovery is fresh; if it isn't in the newest
 * page, it is old enough that a later notification will carry it again.
 */
async function fetchRecovery(accessToken: string, sleepId: string): Promise<NormalisedReading[]> {
  const collection = await authedGetJson(`${API}/recovery?limit=25`, accessToken);
  if (collection === null) return [];

  const records = path(collection, "records");
  if (!Array.isArray(records)) return [];
  const json = records.find((entry) => path(entry, "sleep_id") === sleepId);
  if (!json) return [];

  const instant = toIsoInstant(path(json, "created_at")) ?? toIsoInstant(path(json, "updated_at"));
  const prefix = `whoop:recovery:${sleepId}`;
  return compactReadings([
    reading(
      "resting_heart_rate",
      numberFrom(path(json, "score", "resting_heart_rate")),
      "bpm",
      instant,
      prefix
    ),
    reading("hrv_ms", numberFrom(path(json, "score", "hrv_rmssd_milli")), "ms", instant, prefix),
    reading("spo2", numberFrom(path(json, "score", "spo2_percentage")), "%", instant, prefix),
    reading(
      "recovery_score",
      numberFrom(path(json, "score", "recovery_score")),
      "score",
      instant,
      prefix
    ),
  ]);
}

async function fetchSleep(accessToken: string, sleepId: string): Promise<NormalisedReading[]> {
  const json = await authedGetJson(`${API}/activity/sleep/${sleepId}`, accessToken);
  if (json === null) return [];
  const instant = toIsoInstant(path(json, "end")) ?? toIsoInstant(path(json, "created_at"));
  const prefix = `whoop:sleep:${sleepId}`;

  // WHOOP reports stage durations in milliseconds; the platform stores sleep
  // in minutes, and "asleep" is in-bed minus awake.
  const inBedMs = numberFrom(path(json, "score", "stage_summary", "total_in_bed_time_milli"));
  const awakeMs = numberFrom(path(json, "score", "stage_summary", "total_awake_time_milli"));
  const asleepMinutes = inBedMs === null ? null : Math.round((inBedMs - (awakeMs ?? 0)) / 60000);

  return compactReadings([
    reading("sleep_minutes", asleepMinutes, "min", instant, prefix),
    reading(
      "sleep_efficiency",
      numberFrom(path(json, "score", "sleep_efficiency_percentage")),
      "%",
      instant,
      prefix
    ),
    reading(
      "respiratory_rate",
      numberFrom(path(json, "score", "respiratory_rate")),
      "breaths/min",
      instant,
      prefix
    ),
  ]);
}

async function fetchWorkout(accessToken: string, workoutId: string): Promise<NormalisedReading[]> {
  const json = await authedGetJson(`${API}/activity/workout/${workoutId}`, accessToken);
  if (json === null) return [];
  const instant = toIsoInstant(path(json, "end")) ?? toIsoInstant(path(json, "created_at"));
  const prefix = `whoop:workout:${workoutId}`;

  // WHOOP reports energy as kilojoules.
  const kilojoules = numberFrom(path(json, "score", "kilojoule"));
  const calories = kilojoules === null ? null : Math.round(kilojoules / 4.184);

  return compactReadings([
    reading("strain", numberFrom(path(json, "score", "strain")), "strain", instant, prefix),
    reading("calories", calories, "kcal", instant, prefix),
  ]);
}
