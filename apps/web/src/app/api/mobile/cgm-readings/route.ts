import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { cgmReadingBatchSchema } from "@/lib/validation/cgm-reading";
import { mgDlToMmolL, type TablesInsert } from "@tarragon/shared";

/**
 * CGM (continuous glucose monitoring) ingestion boundary.
 *
 * Mirrors /api/mobile/device-readings: bearer-authenticated, writes into the
 * single vitals_readings table (source='cgm', vital_type='glucose') — no
 * parallel table — and dedupes idempotently. CGM streams many readings so this
 * accepts a batch tied to one cgm_connection.
 *
 * DORMANT until a real CGM partner is onboarded: readings are only accepted for
 * an ACTIVE cgm_connection the caller owns, and no such connection can exist
 * until ops activates a partner. Until then every post gets a clean 404.
 *
 * NOTE: an abnormal CGM reading here does not auto-raise an escalation — same
 * pre-existing gap as the device-BP path (no trigger on vitals_readings, no
 * glucose risk-score helper yet). See the migration header.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) {
    return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = cgmReadingBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const { cgm_connection_id, readings } = parsed.data;

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: "No organisation on file" }, { status: 400 });
  }
  const organisationId = profile.organisation_id;

  // RLS already scopes this to the caller's own connections; the explicit
  // patient_id/status filter makes "someone else's connection" and "a
  // disconnected connection" a clean 404 rather than a silent RLS-empty result.
  const { data: connection } = await supabase
    .from("cgm_connections")
    .select("id")
    .eq("id", cgm_connection_id)
    .eq("patient_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!connection) {
    return NextResponse.json({ error: "CGM connection not found or inactive" }, { status: 404 });
  }

  const rows: TablesInsert<"vitals_readings">[] = readings.map((reading) => ({
    patient_id: user.id,
    organisation_id: organisationId,
    vital_type: "glucose" as const,
    source: "cgm" as const,
    cgm_connection_id,
    external_reading_id: reading.external_reading_id,
    taken_at: reading.taken_at,
    glucose_mmol_l:
      reading.glucose_unit === "mg_dl"
        ? mgDlToMmolL(reading.glucose_value)
        : reading.glucose_value,
  }));

  // Try the batch first; if a partner replays already-synced readings the batch
  // hits 23505 on the partial dedupe index (vitals_readings_cgm_dedupe_idx), so
  // fall back to per-row inserts that skip the duplicates idempotently. (A
  // partial unique index can't be an ON CONFLICT arbiter by column name alone,
  // so this catch-23505 idiom — same as /api/mobile/device-readings — is used
  // instead of upsert.)
  let inserted = 0;
  const { error: batchError } = await supabase.from("vitals_readings").insert(rows);
  if (!batchError) {
    inserted = rows.length;
  } else if (batchError.code === "23505") {
    for (const row of rows) {
      const { error: rowError } = await supabase.from("vitals_readings").insert(row);
      if (!rowError) {
        inserted += 1;
      } else if (rowError.code !== "23505") {
        return NextResponse.json({ error: rowError.message }, { status: 500 });
      }
    }
  } else {
    return NextResponse.json({ error: batchError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, inserted });
}
