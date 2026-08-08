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
}

export async function ingestReadings(
  svc: SupabaseClient<Database>,
  target: IngestTarget,
  readings: NormalisedReading[]
): Promise<IngestResult> {
  const result: IngestResult = { vitalsInserted: 0, wearableInserted: 0, implausible: 0 };
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
