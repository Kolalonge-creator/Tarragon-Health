import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { healthSampleBatchSchema } from "@/lib/validation/health-sample";
import { ingestReadings } from "@/lib/wearables/ingest";
import type { NormalisedReading } from "@/lib/wearables/normalise";

/**
 * Apple Health ingestion boundary for the Expo mobile app.
 *
 * CLAUDE.md's Device & Wearable Integration section calls this out
 * explicitly: HealthKit has no cloud OAuth API at all, its data is
 * device-local, so syncing it needs the mobile app's own HealthKit bridge —
 * the same shape as the BLE clinical-device pairing, not a server-side
 * redirect. That is why apple_health is a wearable_provider enum value but
 * deliberately not a CloudOAuthWearableProvider, and why this route exists
 * alongside api/wearables/webhook rather than inside it.
 *
 * Mirrors api/mobile/device-readings: bearer-authenticated with the mobile
 * session's own JWT, patient identity taken from the verified token and
 * never from the body. Ingestion itself runs service-role because
 * wearable_readings has no authenticated INSERT grant by design — a patient
 * session must not be able to fabricate provider-synced readings — and the
 * vitals_readings rows it writes are locked against later patient edits by
 * private.enforce_vitals_reading_source_lock.
 */

/**
 * The app asks where to resume before reading HealthKit, so a device that
 * has synced before uploads a delta instead of its whole history. Returns
 * null on a first-ever sync, which the app treats as "read a bounded initial
 * window" rather than "read everything ever recorded".
 */
export async function GET(request: Request): Promise<NextResponse> {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const svc = createServiceRoleClient();
  const { data } = await svc
    .from("wearable_connections")
    .select("sync_cursor, last_synced_at")
    .eq("patient_id", auth.userId)
    .eq("provider", "apple_health")
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

  const svc = createServiceRoleClient();
  const connection = await resolveOrCreateConnection(svc, userId, profile.organisation_id);
  if (!connection) {
    return NextResponse.json({ error: "Could not open an Apple Health connection" }, { status: 500 });
  }

  const readings: NormalisedReading[] = parsed.data.samples.map((sample) => ({
    readingType: sample.reading_type,
    value: sample.value,
    secondaryValue: sample.secondary_value,
    unit: sample.unit,
    recordedAt: sample.recorded_at,
    // HealthKit sample UUIDs are unique per device, not per platform, so they
    // are namespaced the same way every cloud provider's ids are.
    externalReadingId: `apple_health:${sample.external_reading_id}`,
  }));

  const result = await ingestReadings(
    svc,
    {
      connectionId: connection.id,
      organisationId: profile.organisation_id,
      patientId: userId,
    },
    readings
  );

  // Advance the cursor to the newest sample actually accepted, so the next
  // sync resumes from there. Uses the batch's own maximum rather than "now":
  // HealthKit writes can land out of order, and a wall-clock cursor would
  // step over a sample the phone had not yet been handed.
  const newestSample = parsed.data.samples.reduce<string | null>((newest, sample) => {
    if (!newest || sample.recorded_at > newest) return sample.recorded_at;
    return newest;
  }, null);

  await svc
    .from("wearable_connections")
    .update({
      last_synced_at: new Date().toISOString(),
      last_sync_error: null,
      ...(newestSample ? { sync_cursor: newestSample } : {}),
    })
    .eq("id", connection.id);

  return NextResponse.json({
    success: true,
    vitals_inserted: result.vitalsInserted,
    wearable_inserted: result.wearableInserted,
    implausible: result.implausible,
    cursor: newestSample,
  });
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
 * One active apple_health connection per patient, matching the partial
 * unique index on (patient_id, provider) where status='active'. Created
 * server-side rather than by the app: since the 20260808023332 migration a
 * patient session cannot insert a connection row at all, which is what stops
 * anyone from claiming a cloud provider account that isn't theirs.
 *
 * external_id is left null deliberately — HealthKit has no provider-side
 * account to point at, which is the whole reason it needs this route.
 */
async function resolveOrCreateConnection(
  svc: ReturnType<typeof createServiceRoleClient>,
  patientId: string,
  organisationId: string
): Promise<{ id: string } | null> {
  const { data: existing } = await svc
    .from("wearable_connections")
    .select("id")
    .eq("patient_id", patientId)
    .eq("provider", "apple_health")
    .eq("status", "active")
    .maybeSingle();
  if (existing) return existing;

  const { data: created, error } = await svc
    .from("wearable_connections")
    .insert({
      organisation_id: organisationId,
      patient_id: patientId,
      provider: "apple_health",
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
        .eq("provider", "apple_health")
        .eq("status", "active")
        .maybeSingle();
      return raced ?? null;
    }
    return null;
  }

  return created;
}
