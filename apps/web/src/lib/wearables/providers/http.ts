import { isRecord } from "../normalise";

/**
 * Bearer GET against a provider API. Same graceful-degradation contract as
 * the rest of the wearables layer and as packages/shared/ml-client.ts: never
 * throws, returns null on any failure. A provider being down, slow, or
 * having changed a field name must not turn into a 500 on a webhook — the
 * provider would just retry the same payload into the same failure.
 */
/** 5s, matching the platform's other outbound-call budget (ml-client.ts, the
 * OAuth token exchange). Deliberately short: these calls happen inside a
 * webhook handler the provider is itself timing out. */
const REQUEST_TIMEOUT_MS = 5000;

export async function authedGetJson(
  url: string,
  accessToken: string,
  extraHeaders: Record<string, string> = {}
): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...extraHeaders,
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Safe nested lookup, so an adapter reads `path(json, "summary", "steps")`
 * instead of a chain of `isRecord` guards at every level. */
export function path(source: unknown, ...keys: string[]): unknown {
  let current = source;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * A provider's daily summary describes a whole calendar day, not an instant,
 * so it needs an arbitrary-but-consistent time of day. Noon UTC is used
 * because the platform's timezone is Africa/Lagos (UTC+1) — midnight would
 * put every daily summary on the previous local day, which is exactly the
 * kind of off-by-one that makes a patient's chart look wrong to a clinician.
 */
export function daySummaryInstant(calendarDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(calendarDate)) return null;
  const parsed = new Date(`${calendarDate}T12:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
