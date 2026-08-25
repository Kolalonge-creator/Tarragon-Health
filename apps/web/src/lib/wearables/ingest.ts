import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "@tarragon/shared";
import { assessBpControlBestEffort } from "@/lib/ml/assess-bp-control";
import { assessHeartRateBestEffort } from "@/lib/vitals/assess-heart-rate";
import {
  isPlausible,
  vitalsEquivalentFor,
  type NormalisedReading,
} from "./normalise";

/**
 * The only place normalised wearable readings become rows.
 *
 * Routing follows CLAUDE.md's ingestion-boundary rule rather than dumping
 * everything in one table: a metric with a vitals_readings equivalent goes
 * there with source='wearable' (so it reaches the same escalation and risk
 * surfaces a manual or BLE-device reading would), and only metrics with no
 * vital_type at all land in wearable_readings.
 *
 * Runs service-role: wearable_readings has no authenticated INSERT grant by
 * design (a patient session must not be able to fabricate a reading claiming
 * to be provider-synced), and vitals_readings rows written here are locked
 * against patient edits by private.enforce_vitals_reading_source_lock.
 */

export interface IngestTarget {
  connectionId: string;
  organisationId: string;
  patientId: string;
}

export interface IngestResult {
  vitalsInserted: number;
  wearableInserted: number;
  /** Values a human would have been blocked from typing for the same vital,
   * or with an unparseable timestamp. Counted rather than silently dropped
   * so a systematically wrong unit mapping shows up as a number. */
  implausible: number;
  /** Days whose step total was written to the patient-facing activity log. */
  stepDaysRecorded: number;
  /** Days skipped because the patient had typed their own step count for
   * that day. Not an error — a sync never overwrites a person's own entry —
   * but worth surfacing rather than hiding as a silent no-op. */
  stepDaysDeferredToManual: number;
}

export async function ingestReadings(
  svc: SupabaseClient<Database>,
  target: IngestTarget,
  readings: NormalisedReading[]
): Promise<IngestResult> {
  const result: IngestResult = {
    vitalsInserted: 0,
    wearableInserted: 0,
    implausible: 0,
    stepDaysRecorded: 0,
    stepDaysDeferredToManual: 0,
  };
  if (readings.length === 0) return result;

  const usable: NormalisedReading[] = [];
  for (const item of readings) {
    if (isPlausible(item)) usable.push(item);
    else result.implausible += 1;
  }
  if (usable.length === 0) return result;

  const vitalsRows: TablesInsert<"vitals_readings">[] = [];
  const wearableRows: TablesInsert<"wearable_readings">[] = [];
  let hasPulse = false;
  let hasBloodPressure = false;

  for (const item of usable) {
    const equivalent = vitalsEquivalentFor(item.readingType);
    if (equivalent) {
      if (equivalent.vitalType === "pulse") hasPulse = true;
      if (equivalent.vitalType === "blood_pressure") hasBloodPressure = true;
      vitalsRows.push({
        patient_id: target.patientId,
        organisation_id: target.organisationId,
        vital_type: equivalent.vitalType,
        source: "wearable",
        wearable_connection_id: target.connectionId,
        external_reading_id: item.externalReadingId,
        taken_at: item.recordedAt,
        [equivalent.column]: item.value,
        ...(equivalent.secondaryColumn && item.secondaryValue !== undefined
          ? { [equivalent.secondaryColumn]: item.secondaryValue }
          : {}),
      } as TablesInsert<"vitals_readings">);
      continue;
    }
    wearableRows.push({
      organisation_id: target.organisationId,
      connection_id: target.connectionId,
      reading_type: item.readingType,
      value: item.value,
      unit: item.unit,
      recorded_at: item.recordedAt,
      external_reading_id: item.externalReadingId,
    });
  }

  result.vitalsInserted = await insertDeduping(vitalsRows, (batch) =>
    svc.from("vitals_readings").insert(batch)
  );
  result.wearableInserted = await insertDeduping(wearableRows, (batch) =>
    svc.from("wearable_readings").insert(batch)
  );

  // wearable_readings is the raw record; it is not what any patient-facing
  // surface reads. The steps meter, the daily activity goal and the wellness
  // challenges all read activity_log_entries, so a synced step total has to
  // land there too or it is invisible — which is exactly what was happening.
  const stepOutcome = await recordStepDays(svc, target, usable);
  result.stepDaysRecorded = stepOutcome.recorded;
  result.stepDaysDeferredToManual = stepOutcome.deferredToManual;

  // Same contract as the BLE device-readings route: the pattern assessment
  // runs after a pulse reading regardless of which path produced it. Once
  // per batch, not per row — it looks at a trailing 30-day window, so
  // running it repeatedly inside one sync would compute the same answer.
  //
  // Glucose deliberately does NOT auto-assess here. A CGM emits a value
  // every ~5 minutes, and firing the glucose red-flag engine on that stream
  // is a different clinical decision from firing it on a fingerstick — the
  // partner CGM route (api/mobile/cgm-readings) made the same call and
  // documented it as an open gap. Whether continuous glucose should raise
  // red flags on its own is for the clinical team to settle, not this
  // module.
  if (result.vitalsInserted > 0) {
    if (hasBloodPressure) {
      await assessBpControlBestEffort(svc, target.patientId, target.organisationId);
    }
    if (hasPulse) {
      await assessHeartRateBestEffort(svc, target.patientId, target.organisationId);
    }
  }

  return result;
}

/**
 * The calendar day a reading belongs to, in Africa/Lagos.
 *
 * Must match how the reader decides "today" (lib/queries/activity.ts uses the
 * same locale/timeZone pair against activity_log_entries.logged_on), or a
 * patient in Lagos would see their steps land on the wrong day near midnight.
 * Deliberately NOT derived from the sample's own `steps:<date>` dedupe key —
 * that one is built from toISOString(), i.e. UTC.
 */
export function lagosDateOf(isoTimestamp: string): string | null {
  const at = new Date(isoTimestamp);
  if (Number.isNaN(at.getTime())) return null;
  // en-CA gives YYYY-MM-DD, which is what a Postgres `date` wants.
  return at.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}

/**
 * Writes each synced day's step total into the patient-facing activity log.
 *
 * Driven from the incoming samples rather than from what insertDeduping
 * actually inserted, and that distinction is the whole point: a day's step
 * count grows as the patient walks, so the same day is re-synced repeatedly
 * with a larger number, and every re-sync after the first collides with the
 * `steps:<date>` dedupe key and is discarded. Keying off inserted rows would
 * therefore have recorded only the first, smallest total of each morning and
 * then frozen it.
 *
 * When several samples cover the same day (two providers, or an overlapping
 * pull window), the largest total wins — step counts only go up within a day,
 * so a smaller number is a staler read of the same day, not a correction.
 */
async function recordStepDays(
  svc: SupabaseClient<Database>,
  target: IngestTarget,
  readings: NormalisedReading[]
): Promise<{ recorded: number; deferredToManual: number }> {
  const largestByDay = new Map<string, number>();
  for (const item of readings) {
    if (item.readingType !== "steps") continue;
    const day = lagosDateOf(item.recordedAt);
    if (!day) continue;
    const steps = Math.round(item.value);
    if (!Number.isFinite(steps) || steps < 0) continue;
    const seen = largestByDay.get(day);
    if (seen === undefined || steps > seen) largestByDay.set(day, steps);
  }

  let recorded = 0;
  let deferredToManual = 0;
  for (const [day, steps] of largestByDay) {
    const { data, error } = await svc.rpc("record_wearable_step_count", {
      p_patient_id: target.patientId,
      p_organisation_id: target.organisationId,
      p_logged_on: day,
      p_step_count: steps,
    });
    // A failure here must not cost the batch its readings — those are already
    // committed above, and the raw total is still in wearable_readings.
    if (error) continue;
    // The function returns null when it deliberately left a manual entry
    // alone, true when it wrote.
    if (data === true) recorded += 1;
    else deferredToManual += 1;
  }
  return { recorded, deferredToManual };
}

/**
 * Batch insert, falling back to per-row on a duplicate.
 *
 * Providers redeliver: Fitbit retries a notification it didn't get a 2xx
 * for, WHOOP resends on any update to the same document, and a scheduled
 * pull re-covers an overlapping window on purpose. Every one of those
 * re-derives the same external_reading_id, so the repeat is a 23505 on the
 * partial dedupe index. A partial unique index can't be an ON CONFLICT
 * arbiter by column name alone, so this uses the same catch-23505 idiom as
 * api/mobile/cgm-readings rather than upsert — one already-seen reading must
 * not cost the batch the genuinely new ones alongside it.
 */
async function insertDeduping<Row>(
  rows: Row[],
  insert: (batch: Row[]) => PromiseLike<{ error: { code: string } | null }>
): Promise<number> {
  if (rows.length === 0) return 0;

  const { error } = await insert(rows);
  if (!error) return rows.length;
  if (error.code !== "23505") return 0;

  let inserted = 0;
  for (const row of rows) {
    const { error: rowError } = await insert([row]);
    if (!rowError) inserted += 1;
  }
  return inserted;
}
