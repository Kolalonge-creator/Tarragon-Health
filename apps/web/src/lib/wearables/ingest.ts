import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "@tarragon/shared";
import { assessBpControlBestEffort } from "@/lib/ml/assess-bp-control";
import { assessHeartRateBestEffort } from "@/lib/vitals/assess-heart-rate";
import {
  consentDecisionFor,
  FULL_WEARABLE_CONSENT,
  isPlausible,
  vitalsEquivalentFor,
  type NormalisedReading,
  type WearableConsent,
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
  /** Per-category patient consent for this connection (53.3/53.4). Defaults
   * to fully consented so every caller that predates granular consent (the
   * mobile HealthKit/Health Connect bridge, which has no wearable_connections
   * row and gates categories at the OS permission level instead) keeps its
   * existing behaviour untouched. */
  consent?: WearableConsent;
}

export interface IngestResult {
  vitalsInserted: number;
  wearableInserted: number;
  /** Values a human would have been blocked from typing for the same vital,
   * or with an unparseable timestamp. Counted rather than silently dropped
   * so a systematically wrong unit mapping shows up as a number. */
  implausible: number;
  /** Readings dropped because the patient denied that category's consent on
   * this connection — a real, deliberate outcome, not an error. Reported to
   * the caller (rather than computed and discarded) so "my sleep data never
   * shows up" is diagnosable without reading two tables. */
  deniedByConsent: number;
  /** Readings stored despite a denied category because the metric arms a
   * red-flag classifier (see consentDecisionFor). Not an error either — but
   * a non-zero count means a patient believes they turned something off that
   * is still being written, which is exactly the thing that should be
   * visible rather than implicit. */
  consentDeniedSafetyRetained: number;
  /** Rows a non-duplicate database error rejected. Never zero-and-silent:
   * ingestReadings throws WearableIngestError when this is non-zero, so no
   * caller can report a clean sync over a batch that did not land. */
  failed: number;
  /** Days whose step total was written to the patient-facing activity log. */
  stepDaysRecorded: number;
  /** Days skipped because the patient had typed their own step count for
   * that day. Not an error — a sync never overwrites a person's own entry —
   * but worth surfacing rather than hiding as a silent no-op. */
  stepDaysDeferredToManual: number;
}

/**
 * Thrown when rows this batch was asked to store did not store.
 *
 * Carries the partial IngestResult so a caller can record what DID land
 * before dealing with the failure — the whole point being that a caller
 * cannot accidentally treat a failed batch as a clean one, which is what
 * happened while a non-duplicate insert error was swallowed into
 * `{ inserted: 0 }` and reported behind `{ ok: true }`.
 */
export class WearableIngestError extends Error {
  readonly code: string;
  readonly result: IngestResult;

  constructor(message: string, code: string, result: IngestResult) {
    super(message);
    this.name = "WearableIngestError";
    this.code = code;
    this.result = result;
  }
}

/** One reading that survived plausibility and the consent decision, plus
 * whether the patient actually consented to it. A reading admitted with
 * `consented: false` is a safety-pipeline metric being stored anyway; it must
 * reach vitals_readings and nothing else. */
interface AdmittedReading {
  reading: NormalisedReading;
  consented: boolean;
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
    deniedByConsent: 0,
    consentDeniedSafetyRetained: 0,
    failed: 0,
    stepDaysRecorded: 0,
    stepDaysDeferredToManual: 0,
  };
  if (readings.length === 0) return result;

  const consent = target.consent ?? FULL_WEARABLE_CONSENT;
  const admitted: AdmittedReading[] = [];
  for (const item of readings) {
    if (!isPlausible(item)) {
      result.implausible += 1;
      continue;
    }
    // The consent flags govern the passive/analytics copy of the data, not
    // the safety pipeline: a denied category still reaches vitals_readings
    // when the metric arms a red-flag classifier, exactly as glucose, blood
    // pressure and SpO2 are already treated. See consentDecisionFor for the
    // reasoning and the list.
    const decision = consentDecisionFor(item, consent);
    if (decision === "denied") {
      result.deniedByConsent += 1;
      continue;
    }
    if (decision === "denied_safety_retained") {
      result.deniedByConsent += 1;
      result.consentDeniedSafetyRetained += 1;
    }
    admitted.push({ reading: item, consented: decision === "allowed" });
  }
  if (admitted.length === 0) return result;

  const vitalsRows: TablesInsert<"vitals_readings">[] = [];
  const wearableRows: TablesInsert<"wearable_readings">[] = [];
  let hasPulse = false;
  let hasBloodPressure = false;

  for (const { reading: item, consented } of admitted) {
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
    // Belt and braces: every safety-pipeline metric has a vitals equivalent,
    // so this branch should only ever see consented readings. Enforced here
    // rather than assumed, so adding a type to
    // SAFETY_PIPELINE_READING_TYPES can never quietly start writing a
    // denied metric into the raw passive store.
    if (!consented) continue;
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

  const vitalsOutcome = await insertDeduping(vitalsRows, (batch) =>
    svc.from("vitals_readings").insert(batch)
  );
  const wearableOutcome = await insertDeduping(wearableRows, (batch) =>
    svc.from("wearable_readings").insert(batch)
  );
  result.vitalsInserted = vitalsOutcome.inserted;
  result.wearableInserted = wearableOutcome.inserted;
  result.failed = vitalsOutcome.failed + wearableOutcome.failed;
  // vitals first: a batch carrying both is far more likely to be diagnosed
  // from the clinically-significant table's error than the passive one's.
  const failure = vitalsOutcome.error ?? wearableOutcome.error;

  // 55.10 data-quality signal: how many of this batch's readings were dropped
  // as implausible, or turned out to already exist (a redelivered webhook, an
  // overlapping pull window). Both are silent successes from the caller's
  // point of view — this is the only place either gets recorded anywhere.
  const duplicates = vitalsOutcome.duplicates + wearableOutcome.duplicates;
  if (result.implausible > 0 || duplicates > 0) {
    await svc.rpc("bump_wearable_connection_ingestion_counters", {
      p_connection_id: target.connectionId,
      p_implausible: result.implausible,
      p_duplicates: duplicates,
    });
  }

  // wearable_readings is the raw record; it is not what any patient-facing
  // surface reads. The steps meter, the daily activity goal and the wellness
  // challenges all read activity_log_entries, so a synced step total has to
  // land there too or it is invisible — which is exactly what was happening.
  const stepOutcome = await recordStepDays(
    svc,
    target,
    // Consented readings only. Steps are never a safety-pipeline metric, so
    // this filter is a no-op today; it exists so the invariant "a denied
    // category never reaches a patient-facing passive surface" is enforced
    // here rather than depending on what SAFETY_PIPELINE_READING_TYPES
    // happens to contain.
    admitted.filter((entry) => entry.consented).map((entry) => entry.reading)
  );
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

  // Last, so everything that DID land is committed, counted, bridged to the
  // activity log and assessed before the failure is raised. A partial batch
  // is a failed batch: the readings that did not store may be the dangerous
  // ones, and there is no way to tell from here which they were.
  if (failure) {
    throw new WearableIngestError(
      `Could not store ${result.failed} wearable reading${result.failed === 1 ? "" : "s"}: ${failure.message} (${failure.code})`,
      failure.code,
      result
    );
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
interface InsertError {
  code: string;
  message: string;
}

interface DedupingOutcome {
  inserted: number;
  /** Rows that collided on the dedupe index (already-seen readings) rather
   * than failing for some other reason. Feeds wearable_connections'
   * duplicate_readings_count (55.10). */
  duplicates: number;
  /** Rows rejected for a reason that is NOT a duplicate — a permission
   * failure, a constraint violation, a bad column. */
  failed: number;
  /** The first non-duplicate error, kept so the caller can put a real reason
   * in last_sync_error instead of a shrug. */
  error: InsertError | null;
}

async function insertDeduping<Row>(
  rows: Row[],
  insert: (batch: Row[]) => PromiseLike<{ error: InsertError | null }>
): Promise<DedupingOutcome> {
  if (rows.length === 0) return { inserted: 0, duplicates: 0, failed: 0, error: null };

  const { error } = await insert(rows);
  if (!error) return { inserted: rows.length, duplicates: 0, failed: 0, error: null };

  // Retry row by row on ANY batch error, not only on 23505.
  //
  // A batch insert aborts atomically, so after a failure nothing was
  // written and the retry cannot double-write. Doing this only for 23505 is
  // what made a permission or constraint failure indistinguishable from an
  // empty sync: the batch returned `{ inserted: 0 }` with no error, no log
  // and no throw, and an entire batch that might have carried a dangerous
  // pulse, SpO2 or glucose value vanished behind a green acknowledgement.
  // The cost of retrying a genuinely doomed batch is one extra round trip
  // per row on a path that is already failing; the cost of not retrying was
  // silent data loss.
  let inserted = 0;
  let duplicates = 0;
  let failed = 0;
  let firstError: InsertError | null = null;
  for (const row of rows) {
    const { error: rowError } = await insert([row]);
    if (!rowError) inserted += 1;
    else if (rowError.code === "23505") duplicates += 1;
    else {
      failed += 1;
      firstError ??= rowError;
    }
  }
  return { inserted, duplicates, failed, error: firstError };
}
