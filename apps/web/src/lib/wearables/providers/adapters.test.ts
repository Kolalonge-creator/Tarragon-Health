import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { fitbitAdapter } from "./fitbit";
import { garminAdapter, isGarminPingPullPayload } from "./garmin";
import { ouraAdapter } from "./oura";
import { whoopAdapter } from "./whoop";
import { PROVIDER_ADAPTERS, PULL_PROVIDERS, WEBHOOK_PROVIDERS } from "./index";

/**
 * Adapters are pure, so the parts worth testing are the two things most
 * likely to be wrong on first contact with a real provider: which account a
 * payload resolves to, and whether a unit conversion is right. The follow-up
 * fetches are exercised against stubbed responses shaped like each
 * provider's documented API.
 */

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
});

function stubFetch(byUrlFragment: Record<string, unknown>) {
  global.fetch = jest.fn(async (input: unknown) => {
    const url = String(input);
    const match = Object.entries(byUrlFragment).find(([fragment]) => url.includes(fragment));
    if (!match) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => match[1] };
  }) as unknown as typeof fetch;
}

describe("adapter registry", () => {
  it("keeps Dexcom out of the webhook set and in the pull set", () => {
    // Dexcom has no push mechanism at all; listing it as a webhook provider
    // would create an endpoint nothing can ever authenticate against.
    expect(WEBHOOK_PROVIDERS).not.toContain("dexcom");
    expect(PULL_PROVIDERS).toEqual(["dexcom"]);
  });

  it("gives every webhook provider a way to read a payload", () => {
    for (const provider of WEBHOOK_PROVIDERS) {
      const adapter = PROVIDER_ADAPTERS[provider];
      expect(Boolean(adapter.readInline) || Boolean(adapter.parseNotifications)).toBe(true);
    }
  });
});

describe("fitbit", () => {
  it("resolves the account from a notification array", () => {
    const notifications = fitbitAdapter.parseNotifications?.([
      { collectionType: "activities", date: "2026-08-08", ownerId: "ABC123", ownerType: "user" },
    ]);
    expect(notifications).toEqual([
      { externalId: "ABC123", target: { collectionType: "activities", date: "2026-08-08" } },
    ]);
  });

  it("ignores a malformed notification rather than inventing an account", () => {
    expect(fitbitAdapter.parseNotifications?.([{ collectionType: "activities" }])).toEqual([]);
    expect(fitbitAdapter.parseNotifications?.({ ownerId: "ABC" })).toEqual([]);
  });

  it("fetches the day's summary a notification only pointed at", async () => {
    stubFetch({
      "/activities/date/": { summary: { steps: 8412, restingHeartRate: 61, caloriesOut: 2100 } },
    });
    const readings = await fitbitAdapter.fetchForNotification?.("token", {
      externalId: "ABC123",
      target: { collectionType: "activities", date: "2026-08-08" },
    });

    expect(readings?.map((r) => [r.readingType, r.value])).toEqual([
      ["steps", 8412],
      ["resting_heart_rate", 61],
      ["calories", 2100],
    ]);
    // A daily summary describes a day, not midnight — noon UTC keeps it on
    // the right local day in Africa/Lagos.
    expect(readings?.[0]?.recordedAt).toBe("2026-08-08T12:00:00.000Z");
  });

  it("gives each metric from one document its own dedupe key", async () => {
    // Keying on the document alone would let the second metric collide with
    // the first and silently disappear.
    stubFetch({ "/activities/date/": { summary: { steps: 10, restingHeartRate: 60 } } });
    const readings = await fitbitAdapter.fetchForNotification?.("token", {
      externalId: "ABC",
      target: { collectionType: "activities", date: "2026-08-08" },
    });
    const ids = readings?.map((r) => r.externalReadingId) ?? [];
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns nothing when the follow-up fetch fails, instead of throwing", async () => {
    stubFetch({});
    await expect(
      fitbitAdapter.fetchForNotification?.("token", {
        externalId: "ABC",
        target: { collectionType: "activities", date: "2026-08-08" },
      })
    ).resolves.toEqual([]);
  });
});

describe("whoop", () => {
  it("stringifies the numeric user_id so it matches a stored external_id", () => {
    expect(
      whoopAdapter.parseNotifications?.({ user_id: 4242, id: 99, type: "recovery.updated" })
    ).toEqual([{ externalId: "4242", target: { type: "recovery.updated", id: "99" } }]);
  });

  it("calls v2, not the removed v1 that returns 404", async () => {
    // The whole failure mode this guards: a v1 path authenticates, resolves
    // a connection, fetches nothing and acks 200 — indistinguishable from a
    // patient with no data.
    const seen: string[] = [];
    global.fetch = jest.fn(async (input: unknown) => {
      seen.push(String(input));
      return { ok: true, status: 200, json: async () => ({ records: [] }) };
    }) as unknown as typeof fetch;

    await whoopAdapter.fetchForNotification?.("token", {
      externalId: "1",
      target: { type: "recovery.updated", id: "sleep-uuid" },
    });
    expect(seen[0]).toContain("/developer/v2/");
    expect(seen[0]).not.toContain("/developer/v1/");
  });

  it("resolves a recovery by the sleep UUID the v2 webhook carries", async () => {
    // v2 recovery webhooks identify the associated SLEEP, and there is no
    // get-recovery-by-id route — so it has to be matched out of the
    // collection on sleep_id rather than fetched directly.
    stubFetch({
      "/recovery": {
        records: [
          { sleep_id: "other-sleep", score: { resting_heart_rate: 99 } },
          {
            sleep_id: "sleep-uuid",
            created_at: "2026-08-08T06:30:00Z",
            score: { resting_heart_rate: 54, hrv_rmssd_milli: 41.2, spo2_percentage: 97, recovery_score: 72 },
          },
        ],
      },
    });

    const readings = await whoopAdapter.fetchForNotification?.("token", {
      externalId: "1",
      target: { type: "recovery.updated", id: "sleep-uuid" },
    });
    // Must pick the matching record, not simply the first one.
    expect(readings?.find((r) => r.readingType === "resting_heart_rate")?.value).toBe(54);
    expect(readings?.find((r) => r.readingType === "spo2")?.value).toBe(97);
  });

  it("ignores a deleted event so a tidy-up cannot erase reviewed data", async () => {
    expect(
      await whoopAdapter.fetchForNotification?.("token", {
        externalId: "1",
        target: { type: "sleep.deleted", id: "x" },
      })
    ).toEqual([]);
  });

  it("converts sleep milliseconds to minutes", async () => {
    stubFetch({
      "/activity/sleep/": {
        end: "2026-08-08T06:00:00Z",
        score: {
          stage_summary: { total_in_bed_time_milli: 28_800_000, total_awake_time_milli: 1_800_000 },
          sleep_efficiency_percentage: 91,
        },
      },
    });
    const sleep = await whoopAdapter.fetchForNotification?.("token", {
      externalId: "1",
      target: { type: "sleep.updated", id: "5" },
    });
    // 8h in bed minus 30m awake = 450 minutes asleep.
    expect(sleep?.find((r) => r.readingType === "sleep_minutes")?.value).toBe(450);
  });

  it("converts workout kilojoules to calories", async () => {
    stubFetch({
      "/activity/workout/": { end: "2026-08-08T18:00:00Z", score: { strain: 12.4, kilojoule: 4184 } },
    });
    const workout = await whoopAdapter.fetchForNotification?.("token", {
      externalId: "1",
      target: { type: "workout.updated", id: "7" },
    });
    expect(workout?.find((r) => r.readingType === "calories")?.value).toBe(1000);
  });
});

describe("oura", () => {
  it("ignores a delete event so a tidy-up cannot erase reviewed data", () => {
    expect(
      ouraAdapter.parseNotifications?.({
        event_type: "delete",
        data_type: "daily_activity",
        object_id: "abc",
        user_id: "u1",
      })
    ).toEqual([]);
  });

  it("skips a data_type this platform has no home for", () => {
    expect(
      ouraAdapter.parseNotifications?.({
        event_type: "create",
        data_type: "tag",
        object_id: "abc",
        user_id: "u1",
      })
    ).toEqual([]);
  });

  it("converts a sleep document's seconds to minutes", async () => {
    stubFetch({
      "/usercollection/sleep/": {
        day: "2026-08-08",
        bedtime_end: "2026-08-08T05:45:00+01:00",
        total_sleep_duration: 25_200,
        efficiency: 88,
        average_hrv: 46,
        lowest_heart_rate: 52,
      },
    });
    const readings = await ouraAdapter.fetchForNotification?.("token", {
      externalId: "u1",
      target: { dataType: "sleep", objectId: "doc1" },
    });
    expect(readings?.find((r) => r.readingType === "sleep_minutes")?.value).toBe(420);
    expect(readings?.find((r) => r.readingType === "resting_heart_rate")?.value).toBe(52);
  });
});

describe("garmin", () => {
  it("groups inline summaries by account, since one POST may carry several", () => {
    const groups = garminAdapter.readInline?.({
      dailies: [
        { userId: "u1", summaryId: "s1", calendarDate: "2026-08-08", steps: 9000, restingHeartRate: 58 },
        { userId: "u2", summaryId: "s2", calendarDate: "2026-08-08", steps: 4000 },
      ],
      bodyComps: [{ userId: "u1", summaryId: "s3", calendarDate: "2026-08-08", weightInGrams: 82500 }],
    });

    expect(groups?.map((g) => g.externalId).sort()).toEqual(["u1", "u2"]);
    const u1 = groups?.find((g) => g.externalId === "u1");
    // grams to kilograms — an unconverted 82500 would be rejected as
    // implausible downstream, which is silent data loss rather than an error.
    expect(u1?.readings.find((r) => r.readingType === "weight")?.value).toBe(82.5);
    expect(u1?.readings.find((r) => r.readingType === "steps")?.value).toBe(9000);
  });

  it("averages Garmin's offset-keyed pulse ox map", () => {
    const groups = garminAdapter.readInline?.({
      pulseOx: [
        {
          userId: "u1",
          summaryId: "s9",
          calendarDate: "2026-08-08",
          timeOffsetSpo2Values: { "0": 96, "600": 98, "1200": 97 },
        },
      ],
    });
    expect(groups?.[0]?.readings.find((r) => r.readingType === "spo2")?.value).toBe(97);
  });

  it("drops a summary with no account to attribute it to", () => {
    expect(garminAdapter.readInline?.({ dailies: [{ summaryId: "s1", steps: 100 }] })).toEqual([]);
  });

  it("reads pulse ox under either casing Garmin uses", () => {
    const lower = garminAdapter.readInline?.({
      pulseox: [{ userId: "u1", summaryId: "s1", calendarDate: "2026-08-08", averageSpo2: 95 }],
    });
    expect(lower?.[0]?.readings.find((r) => r.readingType === "spo2")?.value).toBe(95);
  });

  it("reads blood pressure as one paired reading, not two halves", () => {
    const groups = garminAdapter.readInline?.({
      bloodPressures: [
        {
          userId: "u1",
          summaryId: "bp1",
          calendarDate: "2026-08-08",
          startTimeInSeconds: 1786000000,
          systolic: 148,
          diastolic: 94,
        },
      ],
    });
    const bp = groups?.[0]?.readings.find((r) => r.readingType === "blood_pressure");
    expect(bp?.value).toBe(148);
    expect(bp?.secondaryValue).toBe(94);
  });

  it("distinguishes a Ping/Pull payload from a user with no data", () => {
    // Both shapes are valid JSON with the same top-level keys; without this
    // a misregistered integration acks 200 forever and ingests nothing.
    expect(
      isGarminPingPullPayload({
        dailies: [{ userId: "u1", callbackURL: "https://apis.garmin.com/wellness-api/rest/dailies?x=1" }],
      })
    ).toBe(true);
    expect(
      isGarminPingPullPayload({
        dailies: [{ userId: "u1", summaryId: "s1", calendarDate: "2026-08-08", steps: 10 }],
      })
    ).toBe(false);
  });
});
