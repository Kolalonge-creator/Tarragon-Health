import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  DEVICE_LOCAL_HEALTH_PROVIDERS,
  healthSampleBatchSchema,
  type DeviceLocalHealthProvider,
} from "@/lib/validation/health-sample";
import { ingestReadings, WearableIngestError, type IngestResult } from "@/lib/wearables/ingest";
import type { NormalisedReading } from "@/lib/wearables/normalise";

/**
 * On-device health-store ingestion boundary for the Expo mobile app —
 * Apple Health (iOS) and Android Health Connect.
 *
 * CLAUDE.md's Device & Wearable Integration section calls this out
 * explicitly: neither platform's health store has a cloud OAuth API at all,
 * their data is device-local, so syncing needs the mobile app's own bridge
 * (healthkit.ts / health-connect.ts) — the same shape as the BLE
 * clinical-device pairing, not a server-side redirect. That is why
 * apple_health/android_health_connect are wearable_provider enum values but
 * deliberately not CloudOAuthWearableProvider, and why this route exists
 * alongside api/wearables/webhook rather than inside it. One route handles
 * both providers, distinguished by a `provider` field, because they upload
 * the exact same HealthSample shape.
 *
 * Mirrors api/mobile/device-readings: bearer-authenticated with the mobile
 * session's own JWT, patient identity taken from the verified token and
 * never from the body. Ingestion itself runs service-role because
 * wearable_readings has no authenticated INSERT grant by design — a patient
 * session must not be able to fabricate provider-synced readings — and the
 * vitals_readings rows it writes are locked against later patient edits by
 * private.enforce_vitals_reading_source_lock.
 */

function parseProvider(value: string | null): DeviceLocalHealthProvider {
  return (DEVICE_LOCAL_HEALTH_PROVIDERS as readonly string[]).includes(value ?? "")
    ? (value as DeviceLocalHealthProvider)
    : "apple_health";
}

/**
 * The app asks where to resume before reading its health store, so a device
 * that has synced before uploads a delta instead of its whole history.
 * Returns null on a first-ever sync, which the app treats as "read a
 * bounded initial window" rather than "read everything ever recorded".
 */
export async function GET(request: Request): Promise<NextResponse> {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const provider = parseProvider(new URL(request.url).searchParams.get("provider"));

  const svc = createServiceRoleClient();
  const { data } = await svc
    .from("wearable_connections")
    .select("sync_cursor, last_synced_at")
    .eq("patient_id", auth.userId)
    .eq("provider", provider)
    .eq("status", "active")
    .maybeSingle();

  return NextResponse.json({
    cursor: data?.sync_cursor ?? null,
    last_synced_at: data?.last_synced_at ?? null,
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { userId, supabase } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = healthSampleBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", userId)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: "No organisation on file" }, { status: 400 });
  }

  const provider = parsed.data.provider;
  const svc = createServiceRoleClient();
  const connection = await resolveOrCreateConnection(svc, userId, profile.organisation_id, provider);
  if (!connection) {
    return NextResponse.json({ error: "Could not open a health-store connection" }, { status: 500 });
  }

  const readings: NormalisedReading[] = parsed.data.samples.map((sample) => ({
    readingType: sample.reading_type,
    value: sample.value,
    secondaryValue: sample.secondary_value,
    unit: sample.unit,
    recordedAt: sample.recorded_at,
    // Namespaced by provider, not just "apple_health:" — an iOS and an
    // Android reading could otherwise coincidentally share a raw id and
    // collide on the dedupe index.
    externalReadingId: `${provider}:${sample.external_reading_id}`,
  }));

  // A storage failure is a failed upload, not a quiet zero: the mobile
  // client's own recovery is to re-queue the page and retry (see
  // health-sync.ts's `if (!result.ok)` branch), which only happens if this
  // route stops answering 200 over a batch that did not land.
  let result: IngestResult;
  let failure: WearableIngestError | null = null;
  try {
    result = await ingestReadings(
      svc,
      {
        connectionId: connection.id,
        organisationId: profile.organisation_id,
        patientId: userId,
      },
      readings
    );
  } catch (error) {
    if (!(error instanceof WearableIngestError)) throw error;
    failure = error;
    result = error.result;
  }

  // Advance the cursor to the newest sample actually accepted, so the next
  // sync resumes from there. Uses the batch's own maximum rather than "now":
  // HealthKit writes can land out of order, and a wall-clock cursor would
  // step over a sample the phone had not yet been handed.
  //
  // The constraint that shapes the truncation handling below: the cursor is
  // ONE timestamp shared by every reading type, while the app pages its
  // device-store queries PER TYPE (oldest-first, capped per page). A type
  // that hit its page cap still has unsent samples older than the batch's
  // overall newest, so advancing to the overall newest would skip them
  // permanently. When the app declares which types were capped
  // (truncated_types), the cursor may only advance as far as the oldest of
  // those types' own newest samples — everything at or before that point has
  // been sent for every type. Other types' newer samples simply re-upload
  // next sync and dedupe on external_reading_id. Clients that predate the
  // field omit it and get exactly the old behaviour.
  const newestOf = (samples: typeof parsed.data.samples): string | null =>
    samples.reduce<string | null>((newest, sample) => {
      if (!newest || sample.recorded_at > newest) return sample.recorded_at;
      return newest;
    }, null);

  const truncatedTypes = parsed.data.truncated_types ?? [];
  let newestSample = newestOf(parsed.data.samples);
  for (const readingType of truncatedTypes) {
    const typeNewest = newestOf(parsed.data.samples.filter((s) => s.reading_type === readingType));
    if (!typeNewest) {
      // Declared truncated but sent no samples of that type: no safe bound
      // exists, so hold the cursor where it is rather than guess.
      newestSample = null;
      break;
    }
    if (newestSample && typeNewest < newestSample) newestSample = typeNewest;
  }

  await svc
    .from("wearable_connections")
    .update({
      last_synced_at: new Date().toISOString(),
      // Records the failure instead of erasing it, and holds the cursor
      // where it is: advancing over a window whose rows did not store would
      // skip those samples permanently, since the app resumes from this
      // cursor rather than re-reading its whole health store.
      last_sync_error: failure ? failure.message : null,
      ...(newestSample && !failure ? { sync_cursor: newestSample } : {}),
    })
    .eq("id", connection.id);

  const counts = {
    vitals_inserted: result.vitalsInserted,
    wearable_inserted: result.wearableInserted,
    implausible: result.implausible,
    // Always zero on this route today — the device-local bridge gates
    // categories at the OS permission level and passes no per-connection
    // consent — but reported rather than assumed, so it stays honest if this
    // route ever starts passing one.
    denied_by_consent: result.deniedByConsent,
    consent_denied_safety_retained: result.consentDeniedSafetyRetained,
    failed: result.failed,
    // Step days written to the patient-facing activity log, and days left
    // alone because the patient had typed their own count. Reported
    // separately so "steps synced but the meter didn't move" is diagnosable
    // from the response rather than by reading two tables.
    step_days_recorded: result.stepDaysRecorded,
    step_days_deferred_to_manual: result.stepDaysDeferredToManual,
  };

  if (failure) {
    return NextResponse.json(
      { success: false, error: failure.message, ...counts, cursor: null },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, ...counts, cursor: newestSample });
}

type AuthOk = { userId: string; supabase: ReturnType<typeof createBearerClient> };

async function authenticate(request: Request): Promise<AuthOk | { response: NextResponse }> {
  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) {
    return { response: NextResponse.json({ error: "Missing bearer token" }, { status: 401 }) };
  }

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(accessToken);
  if (error || !user) {
    return { response: NextResponse.json({ error: "Invalid or expired session" }, { status: 401 }) };
  }
  return { userId: user.id, supabase };
}

/**
 * One active connection per (patient, provider), matching the partial
 * unique index on (patient_id, provider) where status='active'. Created
 * server-side rather than by the app: since the 20260808030359 migration a
 * patient session cannot insert a connection row at all, which is what stops
 * anyone from claiming a provider account that isn't theirs.
 *
 * external_id is left null deliberately — neither HealthKit nor Health
 * Connect has a provider-side account to point at, which is the whole
 * reason they need this route instead of an OAuth callback.
 */
async function resolveOrCreateConnection(
  svc: ReturnType<typeof createServiceRoleClient>,
  patientId: string,
  organisationId: string,
  provider: DeviceLocalHealthProvider
): Promise<{ id: string } | null> {
  const { data: existing } = await svc
    .from("wearable_connections")
    .select("id")
    .eq("patient_id", patientId)
    .eq("provider", provider)
    .eq("status", "active")
    .maybeSingle();
  if (existing) return existing;

  const { data: created, error } = await svc
    .from("wearable_connections")
    .insert({
      organisation_id: organisationId,
      patient_id: patientId,
      provider,
      status: "active",
    })
    .select("id")
    .single();

  if (error) {
    // 23505 = two syncs raced to open the first connection; the other one
    // won, so re-read rather than failing the upload.
    if (error.code === "23505") {
      const { data: raced } = await svc
        .from("wearable_connections")
        .select("id")
        .eq("patient_id", patientId)
        .eq("provider", provider)
        .eq("status", "active")
        .maybeSingle();
      return raced ?? null;
    }
    return null;
  }

  return created;
}
