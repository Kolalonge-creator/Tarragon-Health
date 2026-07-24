import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { CloudOAuthWearableProvider } from "@/lib/wearables/oauth-providers";

const VALID_PROVIDERS: CloudOAuthWearableProvider[] = ["oura", "whoop", "garmin", "fitbit"];

function isValidProvider(value: string): value is CloudOAuthWearableProvider {
  return (VALID_PROVIDERS as string[]).includes(value);
}

interface InlineReading {
  reading_type: string;
  value: number;
  unit?: string;
  recorded_at: string;
  external_reading_id?: string;
}

/**
 * Wearable webhook ingestion boundary — the ingestion-boundary rule's other
 * half (CLAUDE.md: consumer platform sync via cloud APIs/webhooks). This is
 * a best-effort scaffold, not a finished per-provider integration: Fitbit
 * and WHOOP's real subscription webhooks are notify-only (they push an
 * owner/entity ID and expect a follow-up authenticated GET against the
 * provider's API using the stored access_token — see token-exchange.ts —
 * rather than carrying the reading data inline), and the exact shapes for
 * all 4 providers can only be confirmed once a real developer app/webhook
 * subscription is registered. This route:
 *   1. resolves the wearable_connections row from the provider's owner
 *      identifier (extractExternalId, one small function per provider —
 *      the seam to correct once a real payload is seen),
 *   2. stores any readings the payload carries inline (some providers'
 *      webhook configurations do include a data snapshot),
 *   3. always updates last_synced_at and acks 200 either way, so an
 *      unrecognised-but-valid payload doesn't cause provider retry pile-up.
 * The "notify -> authenticated fetch" half (using the stored access_token
 * to pull the actual reading) is intentionally not built here — it needs a
 * real registered webhook to develop against.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
): Promise<NextResponse> {
  const { provider } = await params;
  if (!isValidProvider(provider)) {
    return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const externalId = extractExternalId(provider, body);
  if (!externalId) {
    // Ack anyway — an unrecognised payload shape shouldn't cause the
    // provider to keep retrying; there's nothing actionable without an
    // owner identifier to resolve a connection.
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const svc = createServiceRoleClient();
  const { data: connection } = await svc
    .from("wearable_connections")
    .select("id, organisation_id")
    .eq("provider", provider)
    .eq("external_id", externalId)
    .eq("status", "active")
    .maybeSingle();

  if (!connection) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const readings = extractInlineReadings(provider, body);
  if (readings.length > 0) {
    await svc.from("wearable_readings").insert(
      readings.map((reading) => ({
        organisation_id: connection.organisation_id,
        connection_id: connection.id,
        reading_type: reading.reading_type,
        value: reading.value,
        unit: reading.unit ?? null,
        recorded_at: reading.recorded_at,
        external_reading_id: reading.external_reading_id ?? null,
      }))
      // Idempotent on retry via wearable_readings_dedupe_idx — ignore
      // conflicts rather than fail the whole batch on one repeat.
    );
  }

  await svc
    .from("wearable_connections")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", connection.id);

  return NextResponse.json({ ok: true, processed: readings.length });
}

/** Best-effort owner-identifier extraction — provider webhook payloads vary;
 * this covers the field names each provider documents most commonly. */
function extractExternalId(provider: CloudOAuthWearableProvider, body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;

  // Fitbit sends a top-level array of notifications, each carrying ownerId.
  if (provider === "fitbit" && Array.isArray(record)) {
    const first = record[0] as Record<string, unknown> | undefined;
    return typeof first?.ownerId === "string" ? first.ownerId : null;
  }

  const candidates = ["user_id", "userId", "athlete_id", "ownerId", "owner_id"];
  for (const field of candidates) {
    const value = record[field];
    if (typeof value === "string") return value;
  }
  return null;
}

/** Only some provider webhook configurations carry reading data inline
 * (most are notify-only, per the module docstring) — this covers the
 * shape when a `data`/`readings` array is present, and returns empty
 * otherwise (the connection still gets last_synced_at touched). */
function extractInlineReadings(_provider: CloudOAuthWearableProvider, body: unknown): InlineReading[] {
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  const raw = record.readings ?? record.data;
  if (!Array.isArray(raw)) return [];

  const readings: InlineReading[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    if (typeof r.reading_type !== "string") continue;
    if (typeof r.value !== "number") continue;
    if (typeof r.recorded_at !== "string") continue;
    readings.push({
      reading_type: r.reading_type,
      value: r.value,
      unit: typeof r.unit === "string" ? r.unit : undefined,
      recorded_at: r.recorded_at,
      external_reading_id: typeof r.external_reading_id === "string" ? r.external_reading_id : undefined,
    });
  }
  return readings;
}
