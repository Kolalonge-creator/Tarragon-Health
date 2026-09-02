import { supabase } from "./supabase";
import type { HealthSample } from "./healthkit";
import type { HealthProvider } from "./health-sync";

/**
 * The mobile app is a separate deployment from the web app, so it hits the
 * platform's Route Handlers over plain HTTPS, authenticated with the mobile
 * session's own JWT — see apps/web/src/app/api/mobile/device-readings/route.ts
 * and apps/web/src/app/api/mobile/health-samples/route.ts.
 */
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

export interface PostDeviceReadingResult {
  success: boolean;
  error?: string;
}

export async function postDeviceReading(payload: Record<string, unknown>): Promise<PostDeviceReadingResult> {
  const result = await request<Record<string, never>>("/api/mobile/device-readings", "POST", payload);
  return result.ok ? { success: true } : { success: false, error: result.error };
}

export interface PostVitalReadingResult {
  success: boolean;
  error?: string;
}

/** Mirrors the mobileVitalsSchema union in
 * apps/web/src/app/api/mobile/vitals/route.ts — the six vital types the
 * native quick-log screen collects (MOBILE_APP_SPEC.md §2.2). */
export type VitalReadingPayload =
  | { vital_type: "blood_pressure"; systolic: number; diastolic: number; note?: string }
  | {
      vital_type: "glucose";
      glucose_value: number;
      glucose_unit: "mmol_l" | "mg_dl";
      glucose_context: "fasting" | "pre_meal" | "post_meal" | "bedtime" | "night" | "random";
      note?: string;
    }
  | { vital_type: "weight"; weight_kg: number; note?: string }
  | { vital_type: "pulse"; pulse_bpm: number; note?: string }
  | { vital_type: "temperature"; temperature_c: number; note?: string }
  | { vital_type: "spo2"; spo2_pct: number; note?: string };

/** Goes through the API (not a direct client insert) so a dangerous reading
 * triggers the same red-flag/health-score reassessment a web-logged one
 * does; see apps/web/src/app/api/mobile/vitals/route.ts.
 *
 * beneficiaryProfileId is the mobile equivalent of web's acting-for cookie
 * (see lib/acting.ts) — set when the signed-in user currently has a
 * supported person's account open, so the reading is logged for them, not
 * for the caller. The route re-checks the live 'manage' grant itself.
 *
 * clientReadingId, when set, is the offline queue's idempotency key (see
 * offline-vitals-queue.ts) — the route treats a replay of the same id as a
 * successful no-op rather than a duplicate insert, so a queued reading can
 * retry blind after a dropped connection. */
export async function postVitalReading(
  payload: VitalReadingPayload,
  beneficiaryProfileId?: string,
  clientReadingId?: string
): Promise<PostVitalReadingResult> {
  const body = {
    ...payload,
    ...(beneficiaryProfileId ? { beneficiary_profile_id: beneficiaryProfileId } : {}),
    ...(clientReadingId ? { client_reading_id: clientReadingId } : {}),
  };
  const result = await request<Record<string, never>>("/api/mobile/vitals", "POST", body);
  return result.ok ? { success: true } : { success: false, error: result.error };
}

export interface MobileThresholds {
  version: string;
  glucose: Record<string, number>;
  bp: Record<string, { systolic: number; diastolic: number }>;
}

/** Best-effort fetch for threshold-sync.ts — the caller always has a bundled
 * default to fall back to, so this never throws, it just returns null on any
 * failure (offline, auth, or server error alike). */
export async function fetchVitalsThresholds(): Promise<MobileThresholds | null> {
  const result = await request<MobileThresholds>("/api/mobile/vitals-thresholds", "GET");
  return result.ok ? result.data : null;
}

export interface HealthSyncCursor {
  cursor: string | null;
  last_synced_at: string | null;
}

/** Where the last sync for this provider got to, so the app reads a delta
 * rather than re-reading (and re-uploading) the same history every time.
 * Apple Health and Android Health Connect are two independent connections
 * on the server (see route.ts), each with their own cursor. */
export async function getHealthSyncCursor(provider: HealthProvider): Promise<HealthSyncCursor | null> {
  const result = await request<HealthSyncCursor>(
    `/api/mobile/health-samples?provider=${provider}`,
    "GET"
  );
  return result.ok ? result.data : null;
}

export interface PostHealthSamplesResult {
  vitals_inserted: number;
  wearable_inserted: number;
  implausible: number;
  cursor: string | null;
}

export async function postHealthSamples(
  samples: HealthSample[],
  provider: HealthProvider
): Promise<{ ok: true; data: PostHealthSamplesResult } | { ok: false; error: string }> {
  return request<PostHealthSamplesResult>("/api/mobile/health-samples", "POST", {
    samples,
    provider,
  });
}

type RequestResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Nigerian mobile networks routinely go slow-but-not-dead rather than
 * cleanly failing, and React Native's fetch has no built-in timeout — left
 * unbounded, a stalled request hangs the calling screen (a sync "Syncing…"
 * button, a vitals save) indefinitely instead of ever reaching the catch
 * below. 20s is generous enough for a genuinely slow connection to still
 * succeed, short enough that a dead one doesn't strand the UI. */
const REQUEST_TIMEOUT_MS = 20_000;

/** One retry, after a fixed pause, and only for a request that never got a
 * response at all (timed out, or the radio dropped mid-request) — not for
 * one that reached the server and got an HTTP error back, since that may
 * already have taken effect server-side and retrying it blind isn't safe to
 * assume is free. A single flaky beat on a poor connection is exactly what
 * this recovers from without a caller having to notice or handle it. */
const RETRY_DELAY_MS = 1_500;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T>(
  path: string,
  method: "GET" | "POST",
  body?: unknown
): Promise<RequestResult<T>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { ok: false, error: "Not signed in" };
  }

  const url = `${API_BASE_URL}${path}`;
  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };

  let response: Response;
  try {
    response = await fetchWithTimeout(url, init);
  } catch {
    // First attempt never got a response — worth one retry before giving up.
    try {
      await sleep(RETRY_DELAY_MS);
      response = await fetchWithTimeout(url, init);
    } catch {
      return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
    }
  }

  try {
    const json = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      return { ok: false, error: json.error ?? `Request failed (${response.status})` };
    }
    return { ok: true, data: json };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}
