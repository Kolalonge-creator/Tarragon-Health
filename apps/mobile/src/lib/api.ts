import { supabase } from "./supabase";
import { PLATFORM_URL } from "./platform-url";
import type { HealthReadingType, HealthSample } from "./healthkit";
import type { HealthProvider } from "./health-sync";

/**
 * The mobile app is a separate deployment from the web app, so it hits the
 * platform's Route Handlers over plain HTTPS, authenticated with the mobile
 * session's own JWT — see apps/web/src/app/api/mobile/device-readings/route.ts
 * and apps/web/src/app/api/mobile/health-samples/route.ts.
 *
 * Falls back to PLATFORM_URL (the same host the WebView bridge already
 * defaults to) when EXPO_PUBLIC_API_BASE_URL is unset — an unset env var
 * used to interpolate as the literal string "undefined/api/…", which failed
 * every request with an unhelpful error rather than an obvious config gap.
 */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? PLATFORM_URL;

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

/**
 * `truncatedTypes` declares which reading types' device-store reads hit
 * their per-type page cap (healthkit.ts / health-connect.ts's
 * PER_TYPE_LIMIT), so the route's shared sync cursor won't advance past a
 * type's still-unsent backlog (healthSampleBatchSchema.truncated_types).
 * Omitted from the request body entirely when nothing was truncated — the
 * server treats an absent field exactly like an old app version that
 * predates it, which keeps that path the well-trodden default.
 */
export async function postHealthSamples(
  samples: HealthSample[],
  provider: HealthProvider,
  truncatedTypes?: HealthReadingType[]
): Promise<{ ok: true; data: PostHealthSamplesResult } | { ok: false; error: string }> {
  return request<PostHealthSamplesResult>("/api/mobile/health-samples", "POST", {
    samples,
    provider,
    ...(truncatedTypes && truncatedTypes.length > 0 ? { truncated_types: truncatedTypes } : {}),
  });
}

export interface PostDeviceFaultReportResult {
  success: boolean;
  reportId?: string;
  status?: string;
  error?: string;
}

/** "My BP machine isn't working" — spec §52.12. Filed against the pairing
 * (patient_device_id from patient_devices, e.g. the Devices screen's
 * current list), not a device_units id the app never sees directly. */
export async function postDeviceFaultReport(
  patientDeviceId: string,
  description: string
): Promise<PostDeviceFaultReportResult> {
  const result = await request<{ report_id: string; status: string }>(
    "/api/mobile/device-faults",
    "POST",
    { patient_device_id: patientDeviceId, description }
  );
  return result.ok
    ? { success: true, reportId: result.data.report_id, status: result.data.status }
    : { success: false, error: result.error };
}

/** Gives a just-confirmed telemedicine/result-interpretation appointment its
 * Zoom join link right away, instead of waiting for the first "Join call"
 * tap to discover one doesn't exist yet — see
 * apps/web/src/app/api/mobile/appointments/setup-video/route.ts. Best-effort
 * by design: appointments.ts's bookAppointment() calls this after the
 * booking is already confirmed and ignores its result, the same fallback
 * web itself relies on if Zoom is briefly unreachable — a missing join link
 * is recovered the next time this (or the web equivalent) runs, never a
 * reason to fail a booking that already succeeded. */
export async function postAppointmentVideoSetup(appointmentId: string): Promise<{ success: boolean; error?: string }> {
  const result = await request<{ ok: boolean }>("/api/mobile/appointments/setup-video", "POST", {
    appointmentId,
  });
  return result.ok ? { success: true } : { success: false, error: result.error };
}

export interface LifestyleActionResult {
  success?: boolean;
  message?: string;
  needsEdScreen?: boolean;
  error?: string;
}

/** Mirrors apps/web/src/app/api/mobile/lifestyle/enroll/route.ts (the
 * mobile equivalent of enrollAction — see that route's own comment for why
 * this needs a server round-trip rather than a direct client insert). */
export async function postLifestyleEnroll(
  conditionKey: "htn" | "diabetes" | "obesity",
  consent: boolean
): Promise<LifestyleActionResult> {
  const result = await request<LifestyleActionResult>("/api/mobile/lifestyle/enroll", "POST", {
    conditionKey,
    consent,
  });
  return result.ok ? result.data : { error: result.error };
}

export interface ObesityEdScreenInput {
  consent: boolean;
  scoff_sick?: boolean;
  scoff_control?: boolean;
  scoff_one_stone?: boolean;
  scoff_fat?: boolean;
  scoff_food_dominates?: boolean;
  self_harm_risk?: boolean;
  low_mood?: boolean;
  disordered_behaviours: string[];
  notes?: string;
}

/** Mirrors apps/web/src/app/api/mobile/lifestyle/ed-screen-enroll/route.ts. */
export async function postObesityEdScreenAndEnroll(input: ObesityEdScreenInput): Promise<LifestyleActionResult> {
  const result = await request<LifestyleActionResult>("/api/mobile/lifestyle/ed-screen-enroll", "POST", input);
  return result.ok ? result.data : { error: result.error };
}

/** Mirrors apps/web/src/app/api/mobile/lifestyle/log/route.ts (the mobile
 * equivalent of logReadingAction — see that route's own comment for why
 * this needs a server round-trip: red-flag evaluation must not be
 * duplicated client-side). */
export async function postLifestyleLog(input: {
  enrollmentId: string;
  conditionKey: "htn" | "diabetes" | "obesity";
  type: "weight" | "activity_minutes" | "mood";
  value?: number;
  strugglingWithFood?: boolean;
}): Promise<LifestyleActionResult> {
  const result = await request<LifestyleActionResult>("/api/mobile/lifestyle/log", "POST", input);
  return result.ok ? result.data : { error: result.error };
}

export interface SleepLogInput {
  duration_hours: number;
  quality_rating?: number;
  bedtime?: string;
  waketime?: string;
  daytime_sleepiness?: number;
  note?: string;
}

/**
 * Mirrors apps/web/src/app/api/mobile/lifestyle/sleep-log/route.ts.
 *
 * Sleep is the one lifestyle tracker that is not a plain insert: the server
 * runs flagAbnormalSleep() afterwards, which can raise a clinical alert on a
 * dangerously short night or severe daytime sleepiness. Writing this straight
 * from the app would save the row and silently skip that check, so this stays
 * a thin passthrough rather than a second implementation. The other trackers
 * carry no such side effect and write directly under RLS -- see
 * lib/lifestyle-trackers.ts.
 */
export async function postSleepLog(input: SleepLogInput): Promise<{ error?: string }> {
  const result = await request<{ ok?: boolean; error?: string }>(
    "/api/mobile/lifestyle/sleep-log",
    "POST",
    input
  );
  return result.ok ? {} : { error: result.error };
}

export type MentalHealthScreenAnswers = Record<string, number | boolean>;

/** Mirrors apps/web/src/app/api/mobile/mental-health-screen/route.ts (the
 * mobile equivalent of submitMentalHealthScreen). Scoring, the
 * service-role insert, and the self-harm → emergency_events crisis pathway
 * all happen server-side — this is a thin, unmodified passthrough, not a
 * second implementation of any of that logic. */
export async function postMentalHealthScreen(
  answers: MentalHealthScreenAnswers
): Promise<{ success?: boolean; crisis?: boolean; error?: string }> {
  const result = await request<{ success?: boolean; crisis?: boolean }>(
    "/api/mobile/mental-health-screen",
    "POST",
    answers
  );
  return result.ok ? result.data : { error: result.error };
}

/** Mirrors apps/web/.../patient/health-check-video-consult-actions.ts's
 * confirmHealthCheckVideoConsultSlot (the mobile equivalent) — a real Zoom
 * meeting + service-role write + notification all happen server-side, so
 * this is a thin passthrough, not a second implementation of that side
 * effect. See apps/web/src/app/api/mobile/health-check/confirm-video-slot/route.ts. */
export async function postConfirmHealthCheckVideoSlot(
  consultId: string,
  slot: string
): Promise<{ success?: boolean; error?: string }> {
  const result = await request<{ success?: boolean }>("/api/mobile/health-check/confirm-video-slot", "POST", {
    consultId,
    slot,
  });
  return result.ok ? result.data : { error: result.error };
}

/** Mirrors apps/web/.../patient/sexual-health/sti-actions.ts's
 * submitStiRiskCheck (the mobile equivalent) — scoring and the service-role
 * insert (+ conditional clinician_alerts insert) happen server-side; this
 * is a thin passthrough, never a second implementation of that scoring. */
export async function postStiRiskCheck(
  answers: Record<string, unknown>
): Promise<{ success?: boolean; riskLevel?: string; recommendedScreenCodes?: string[]; error?: string }> {
  const result = await request<{ success?: boolean; riskLevel?: string; recommendedScreenCodes?: string[] }>(
    "/api/mobile/sexual-health/sti-risk-check",
    "POST",
    answers
  );
  return result.ok ? result.data : { error: result.error };
}

/** Mirrors fertility-actions.ts's submitFertilityAssessment — age lookup,
 * scoring, and the service-role insert (+ conditional specialist_referrals
 * insert) all happen server-side. */
export async function postFertilityAssessment(input: {
  trying_duration_months: number;
  menstrual_cycle_regular?: boolean;
  known_risk_factors: string[];
}): Promise<{ success?: boolean; recommendedAction?: string; error?: string }> {
  const result = await request<{ success?: boolean; recommendedAction?: string }>(
    "/api/mobile/sexual-health/fertility-assessment",
    "POST",
    input
  );
  return result.ok ? result.data : { error: result.error };
}

/** Mirrors sexual-wellness-actions.ts's submitSexualHealthScreen — scoring
 * and the service-role insert happen server-side, never client-trusted. */
export async function postSexualWellnessScreen(
  instrument: string,
  items: number[]
): Promise<{ success?: boolean; totalScore?: number; severityBand?: string; cardiometabolicFlag?: boolean; error?: string }> {
  const result = await request<{ success?: boolean; totalScore?: number; severityBand?: string; cardiometabolicFlag?: boolean }>(
    "/api/mobile/sexual-health/sexual-wellness-screen",
    "POST",
    { instrument, items }
  );
  return result.ok ? result.data : { error: result.error };
}

export interface LabOrderCheckoutResult {
  checkoutUrl?: string;
  error?: string;
}

/** Mirrors apps/web/src/app/api/mobile/lab-orders/checkout/route.ts, the
 * mobile wrapper around createAndPayForLabOrder (the same function the web
 * "Book & pay" button uses) — same reasoning as postServicesCheckout:
 * initiating the Paystack checkout needs the secret key, never shipped to
 * a client. Deliberately not sexual-health-specific — any self-bookable
 * panel_bundle can be checked out through this one route. */
export async function postLabOrderCheckout(
  panelBundleId: string,
  callbackUrl: string
): Promise<LabOrderCheckoutResult> {
  const result = await request<LabOrderCheckoutResult>("/api/mobile/lab-orders/checkout", "POST", {
    panelBundleId,
    callbackUrl,
  });
  return result.ok ? result.data : { error: result.error };
}

export interface CoachTurnResponse {
  success?: boolean;
  conversationId?: string;
  reply?: string;
  tier?: "routine" | "clinician_review" | "emergency";
  aiInteractionId?: string | null;
  error?: string;
}

/** Mirrors apps/web/.../patient/ai-coach-actions.ts's sendCoachMessage --
 * see apps/web/src/app/api/mobile/ai-coach/message/route.ts. Entitlement,
 * rate-limiting, the governed Claude call, and the emergency-keyword safety
 * net all happen server-side; this is a thin passthrough. */
export async function postCoachMessage(
  message: string,
  conversationId?: string
): Promise<CoachTurnResponse> {
  const result = await request<CoachTurnResponse>("/api/mobile/ai-coach/message", "POST", {
    message,
    conversationId,
  });
  return result.ok ? result.data : { error: result.error };
}

export type CoachQuickActionKind = "explain_record" | "care_plan_summary" | "appointment_prep";

/** Mirrors ai-coach-quick-action.ts's runAiCoachQuickAction -- see
 * apps/web/src/app/api/mobile/ai-coach/quick-action/route.ts. These three
 * surfaces are deterministic and never call Claude. */
export async function postCoachQuickAction(
  kind: CoachQuickActionKind,
  conversationId?: string
): Promise<CoachTurnResponse> {
  const result = await request<CoachTurnResponse>("/api/mobile/ai-coach/quick-action", "POST", {
    kind,
    conversationId,
  });
  return result.ok ? result.data : { error: result.error };
}

/** Mirrors handoff-actions.ts's requestCareTeamHandoffAction (§78.12 "I want
 * to speak to someone") -- see apps/web/src/app/api/mobile/ai-coach/handoff/route.ts. */
export async function postCoachHandoffToCareTeam(
  conversationId?: string
): Promise<{ success?: boolean; threadId?: string; error?: string }> {
  const result = await request<{ success?: boolean; threadId?: string }>(
    "/api/mobile/ai-coach/handoff",
    "POST",
    { conversationId }
  );
  return result.ok ? result.data : { error: result.error };
}

/**
 * The one error message request() returns when it never got a usable
 * response from the server (network drop, timeout, or an unparseable
 * body). offline-vitals-queue.ts compares against this exact value to
 * decide "the device is offline, stop draining the queue" — which is why
 * it is a shared constant rather than a literal repeated in both files: a
 * copy edit to the patient-facing wording must not silently break that
 * retry classification.
 */
export const NETWORK_ERROR_MESSAGE = "Couldn't reach the server. Check your connection and try again.";

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

/**
 * The timeout + single-retry-on-no-response policy above, exported for the
 * one caller that can't go through request() because its body isn't JSON
 * (labs.ts's multipart photo upload). Rejects only when neither attempt got
 * a response at all — an HTTP error status still resolves, exactly like
 * request()'s own behaviour, since a request that reached the server may
 * already have taken effect and must not be retried blind.
 */
export async function fetchWithTimeoutAndRetry(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchWithTimeout(url, init);
  } catch {
    await sleep(RETRY_DELAY_MS);
    return fetchWithTimeout(url, init);
  }
}

async function request<T>(
  path: string,
  method: "GET" | "POST",
  body?: unknown,
  isRetry = false
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
    response = await fetchWithTimeoutAndRetry(url, init);
  } catch {
    return { ok: false, error: NETWORK_ERROR_MESSAGE };
  }

  // A 401 here means the server rejected a token the client still considers
  // valid (e.g. revoked server-side, or expired just ahead of the client's
  // own auto-refresh). Try one explicit refresh-and-retry before giving up —
  // otherwise a stale-but-not-yet-refreshed token surfaces as a confusing
  // "Request failed (401)" instead of either succeeding or signing out.
  if (response.status === 401 && !isRetry) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (!refreshError && refreshed.session) {
      return request<T>(path, method, body, true);
    }
    await supabase.auth.signOut();
    return { ok: false, error: "Your session expired — please sign in again." };
  }

  try {
    const json = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      return { ok: false, error: json.error ?? `Request failed (${response.status})` };
    }
    return { ok: true, data: json };
  } catch {
    return { ok: false, error: NETWORK_ERROR_MESSAGE };
  }
}
