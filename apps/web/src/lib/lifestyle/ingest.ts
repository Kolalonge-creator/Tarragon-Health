import "server-only";
/**
 * LPE measurement ingestion — the golden data-flow (spec §3.3, §8, §9).
 *
 *   validate → persist → evaluateRedFlags (BEFORE any reply) → write flags
 *   → (DB trigger raises the alert + auto-pauses weight-loss in the same txn)
 *
 * SAFETY CONTRACT: callers MUST NOT emit any patient-facing reply until this
 * resolves. The returned `evaluation`/`replyMessageKey` is what a safe reply is
 * built from — a flagged reading yields a safety-net message, never "you're fine".
 *
 * The measurement (a patient's own raw input) is written on the CALLER's
 * RLS-scoped session so RLS keeps doing its job. Only the system-authored
 * red-flag rows use the service-role client — a patient can never forge or
 * stand down a flag (RLS insert on lpe_red_flag_events is org-staff-only).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";
import {
  evaluateRedFlags,
  validateMeasurement,
  getAdapter,
  type ConditionKey,
  type MeasurementInput,
  type PatientContext,
  type RedFlagEvaluation,
} from "@tarragon/lifestyle-engine";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface IngestParams {
  /** The caller's RLS-scoped client (the patient's own session). */
  db: SupabaseClient<Database>;
  organisationId: string;
  patientId: string;
  enrollmentId: string | null;
  conditionKey: ConditionKey;
  patientContext: PatientContext;
  measurement: MeasurementInput;
  /** Recent same-type history for rate/trend rules (most-recent-first). */
  recent?: MeasurementInput[];
}

export interface IngestResult {
  ok: boolean;
  reason?: string;
  measurementId?: string;
  evaluation?: RedFlagEvaluation;
  /** Message key a safe reply is built from; null when nothing fired. */
  replyMessageKey?: string | null;
}

export async function ingestMeasurement(params: IngestParams): Promise<IngestResult> {
  const {
    db,
    organisationId,
    patientId,
    enrollmentId,
    conditionKey,
    patientContext,
    measurement,
    recent,
  } = params;

  // 1. Validate (plausibility + the whatsapp-source guard). Never silently drop.
  const validation = validateMeasurement(measurement);
  if (!validation.ok) {
    return { ok: false, reason: validation.reason };
  }

  // 2. Persist the measurement (source of truth) on the patient's own session.
  const { data: stored, error: storeErr } = await db
    .from("lpe_measurements")
    .insert({
      organisation_id: organisationId,
      patient_id: patientId,
      enrollment_id: enrollmentId,
      type: measurement.type,
      value_num: measurement.valueNum ?? null,
      value_json: (measurement.valueJson ?? null) as Json,
      unit: measurement.unit,
      context: (measurement.context ?? null) as Json,
      taken_at: measurement.takenAt,
      source: measurement.source,
      validated: true,
    })
    .select("id")
    .single();

  if (storeErr || !stored) {
    return { ok: false, reason: "persist_failed" };
  }
  const measurementId = stored.id;

  // 3. Evaluate red flags BEFORE planning any reply (hard requirement).
  const adapter = getAdapter(conditionKey);
  const evaluation = evaluateRedFlags(
    { measurement, recent },
    adapter.redFlags,
    patientContext,
  );

  // 4. Persist every fired flag. The DB trigger raises the worklist alert and
  //    auto-pauses weight-loss (for an ED/self-harm action) in the same txn.
  if (evaluation.hasFlag) {
    const svc = createServiceRoleClient();
    const rows = evaluation.fired.map((f) => ({
      organisation_id: organisationId,
      patient_id: patientId,
      enrollment_id: enrollmentId,
      measurement_id: measurementId,
      rule_key: f.key,
      severity: f.severity,
      escalation_level: f.level,
      action: f.action,
    }));
    const { data: flagRows, error: flagErr } = await svc
      .from("lpe_red_flag_events")
      .insert(rows)
      .select("id, severity");

    if (flagErr) {
      // A flagged reading must never be lost. Surface loudly to the caller so
      // it can safety-net and log; the measurement is already persisted.
      return { ok: false, reason: "flag_persist_failed", measurementId, evaluation };
    }

    // Link the measurement to its top (most-severe) flag.
    const topId = flagRows?.[0]?.id;
    if (topId) {
      await svc
        .from("lpe_measurements")
        .update({ flagged: true, red_flag_event_id: topId })
        .eq("id", measurementId);
    }
  }

  return {
    ok: true,
    measurementId,
    evaluation,
    replyMessageKey: evaluation.replyMessageKey,
  };
}
