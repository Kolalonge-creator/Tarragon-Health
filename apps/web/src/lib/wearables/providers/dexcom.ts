import { mgDlToMmolL } from "@tarragon/shared";
import {
  compactReadings,
  isRecord,
  numberFrom,
  reading,
  toIsoInstant,
  type NormalisedReading,
} from "../normalise";
import { authedGetJson, path } from "./http";
import type { ProviderAdapter } from "./types";

/**
 * Dexcom — pull-only.
 *
 * Dexcom has no webhook mechanism at all: estimated glucose values are read
 * from `/v3/users/self/egvs` over a requested window, which is why the
 * webhook route rejects `dexcom` outright and the scheduled sync
 * (api/cron/wearable-sync) is the only thing that ever calls this adapter.
 *
 * Provenance note: a Dexcom sensor reached through this patient-OAuth path
 * lands in vitals_readings as source='wearable' with a wearable_connection_id,
 * while the separate (and still dormant) partner-CGM integration writes the
 * same physical sensor's data as source='cgm' with a cgm_connection_id. They
 * dedupe independently, so if a Dexcom partner integration is ever activated
 * for a patient who ALSO connected Dexcom themselves, the same glucose value
 * can land twice under two provenances. Pick one path per patient rather
 * than assuming the dedupe index will sort it out.
 *
 * CAVEAT: written against Dexcom's documented v3 API, not verified against a
 * live sandbox account.
 */

const API = "https://api.dexcom.com";

/** Dexcom rejects a window longer than 30 days, and a CGM emits a value
 * roughly every 5 minutes (~288/day) — this bound keeps a long-dormant
 * connection's first catch-up from turning into an unbounded insert. */
const MAX_WINDOW_DAYS = 30;
const MAX_RECORDS = 2000;

export const dexcomAdapter: ProviderAdapter = {
  async fetchSince(accessToken: string, since: Date, until: Date): Promise<NormalisedReading[]> {
    const windowStart = clampWindowStart(since, until);
    if (windowStart >= until) return [];

    // Dexcom expects a naive local-ish timestamp with no timezone suffix.
    const url =
      `${API}/v3/users/self/egvs` +
      `?startDate=${dexcomTimestamp(windowStart)}&endDate=${dexcomTimestamp(until)}`;
    const json = await authedGetJson(url, accessToken);
    if (json === null) return [];

    // v3 returns `records`; v2 returned `egvs`. Accept either so a version
    // pin change doesn't silently ingest nothing.
    const raw = path(json, "records") ?? path(json, "egvs");
    if (!Array.isArray(raw)) return [];

    return compactReadings(
      raw.slice(0, MAX_RECORDS).map((entry) => {
        if (!isRecord(entry)) return null;
        const value = numberFrom(entry.value);
        if (value === null) return null;

        // `unit` is "mg/dL" on every documented response, but honouring it
        // rather than assuming costs nothing and avoids a silent 18x error.
        const unit = typeof entry.unit === "string" ? entry.unit.toLowerCase() : "mg/dl";
        const mmol = unit.includes("mmol") ? value : mgDlToMmolL(value);

        // systemTime is the sensor's own clock and is what recordId is keyed
        // to; displayTime is the patient's shifted display value.
        const instant = toIsoInstant(entry.systemTime) ?? toIsoInstant(entry.displayTime);
        const recordId = typeof entry.recordId === "string" ? entry.recordId : instant;
        if (recordId === null) return null;

        return reading("glucose", mmol, "mmol/L", instant, `dexcom:egv:${recordId}`);
      })
    );
  },
};

function clampWindowStart(since: Date, until: Date): Date {
  const earliest = new Date(until.getTime() - MAX_WINDOW_DAYS * 24 * 3600_000);
  return since > earliest ? since : earliest;
}

function dexcomTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "");
}
