import {
  compactReadings,
  isRecord,
  numberFrom,
  reading,
  type NormalisedReading,
} from "../normalise";
import { authedGetJson, daySummaryInstant, path } from "./http";
import type { ProviderAdapter, WebhookNotification } from "./types";

/**
 * Fitbit — notify-then-fetch.
 *
 * Subscription notifications are a JSON array of
 * `{collectionType, date, ownerId, ownerType, subscriptionId}` and carry no
 * measurements at all: `collectionType` says which of the day's collections
 * changed, and the values are behind an authenticated GET for that date.
 *
 * Units: Fitbit returns values in the unit system named by the request's
 * `Accept-Language` header — `en_US` gives US units and `en_GB` gives UK
 * (stone!), while OMITTING the header gives metric. This adapter therefore
 * deliberately sends no Accept-Language, which is why weights come back in
 * kilograms. Do not add one.
 *
 * CAVEAT (as with the rest of this layer): written against Fitbit's
 * documented Web API, not verified against a live subscription — no real
 * developer app exists yet. The field lookups below are the seam to correct
 * the first time a real notification is seen.
 */

const API = "https://api.fitbit.com";

/** SpO2 has no subscription collectionType of its own, but Fitbit only
 * records it during sleep — so a sleep notification is the correct trigger
 * to also pull that night's SpO2 summary. */
const SLEEP_ALSO_FETCHES_SPO2 = true;

export const fitbitAdapter: ProviderAdapter = {
  parseNotifications(body: unknown): WebhookNotification[] {
    if (!Array.isArray(body)) return [];
    const notifications: WebhookNotification[] = [];
    for (const entry of body) {
      if (!isRecord(entry)) continue;
      const ownerId = entry.ownerId;
      const collectionType = entry.collectionType;
      const date = entry.date;
      if (typeof ownerId !== "string" || typeof collectionType !== "string") continue;
      if (typeof date !== "string") continue;
      notifications.push({ externalId: ownerId, target: { collectionType, date } });
    }
    return notifications;
  },

  async fetchForNotification(
    accessToken: string,
    notification: WebhookNotification
  ): Promise<NormalisedReading[]> {
    const { collectionType, date } = notification.target;
    const instant = daySummaryInstant(date);
    if (!instant) return [];

    if (collectionType === "activities") {
      return fetchActivities(accessToken, date, instant);
    }
    if (collectionType === "sleep") {
      const sleep = await fetchSleep(accessToken, date, instant);
      if (!SLEEP_ALSO_FETCHES_SPO2) return sleep;
      return [...sleep, ...(await fetchSpo2(accessToken, date, instant))];
    }
    if (collectionType === "body") {
      return fetchWeight(accessToken, date);
    }
    // `userRevokedAccess` and `foods` are real collectionTypes with nothing
    // for this platform to ingest; anything unrecognised is simply skipped.
    return [];
  },
};

async function fetchActivities(
  accessToken: string,
  date: string,
  instant: string
): Promise<NormalisedReading[]> {
  const json = await authedGetJson(`${API}/1/user/-/activities/date/${date}.json`, accessToken);
  if (json === null) return [];
  const prefix = `fitbit:activities:${date}`;
  return compactReadings([
    reading("steps", numberFrom(path(json, "summary", "steps")), "steps", instant, prefix),
    reading(
      "resting_heart_rate",
      numberFrom(path(json, "summary", "restingHeartRate")),
      "bpm",
      instant,
      prefix
    ),
    reading("calories", numberFrom(path(json, "summary", "caloriesOut")), "kcal", instant, prefix),
  ]);
}

async function fetchSleep(
  accessToken: string,
  date: string,
  instant: string
): Promise<NormalisedReading[]> {
  const json = await authedGetJson(`${API}/1.2/user/-/sleep/date/${date}.json`, accessToken);
  if (json === null) return [];
  const prefix = `fitbit:sleep:${date}`;

  // `sleep[]` holds each session; the main sleep is the one Fitbit marks
  // isMainSleep, and its efficiency is the meaningful one to keep.
  const sessions = path(json, "sleep");
  const main = Array.isArray(sessions)
    ? (sessions.find((s) => isRecord(s) && s.isMainSleep === true) ?? sessions[0])
    : undefined;

  return compactReadings([
    reading(
      "sleep_minutes",
      numberFrom(path(json, "summary", "totalMinutesAsleep")),
      "min",
      instant,
      prefix
    ),
    reading("sleep_efficiency", numberFrom(path(main, "efficiency")), "%", instant, prefix),
  ]);
}

async function fetchSpo2(
  accessToken: string,
  date: string,
  instant: string
): Promise<NormalisedReading[]> {
  const json = await authedGetJson(`${API}/1/user/-/spo2/date/${date}.json`, accessToken);
  if (json === null) return [];
  return compactReadings([
    reading(
      "spo2",
      numberFrom(path(json, "value", "avg")),
      "%",
      instant,
      `fitbit:spo2:${date}`
    ),
  ]);
}

async function fetchWeight(accessToken: string, date: string): Promise<NormalisedReading[]> {
  const json = await authedGetJson(`${API}/1/user/-/body/log/weight/date/${date}.json`, accessToken);
  if (json === null) return [];
  const logs = path(json, "weight");
  if (!Array.isArray(logs)) return [];

  // Unlike the daily summaries, a weight log carries its own timestamp, so
  // it gets the real instant rather than the noon-UTC stand-in.
  return compactReadings(
    logs.map((log) => {
      if (!isRecord(log)) return null;
      const logDate = typeof log.date === "string" ? log.date : date;
      const logTime = typeof log.time === "string" ? log.time : "12:00:00";
      const parsed = new Date(`${logDate}T${logTime}Z`);
      if (Number.isNaN(parsed.getTime())) return null;
      const logId = numberFrom(log.logId);
      return reading(
        "weight",
        numberFrom(log.weight),
        "kg",
        parsed.toISOString(),
        `fitbit:weight:${logId ?? `${logDate}T${logTime}`}`
      );
    })
  );
}
