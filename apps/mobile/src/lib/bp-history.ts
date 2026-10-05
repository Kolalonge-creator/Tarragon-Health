import { supabase } from "./supabase";
import type { VitalReadingPayload } from "./api";
import { listOutbox } from "./outbox";
import { readLocalRecords } from "./offline-store";
import { createCorrectionRequest } from "./profile";
import {
  buildRecordDescription,
  mergeReadings,
  type CorrectionRequest,
  type HistoryReading,
  type QueuedBp,
  type RecordCorrection,
  type RequestStatus,
  type ServerBpRow,
} from "./bp-history-model";

/** Enough for months of twice-daily readings; the screen is a list, not a chart. */
export const HISTORY_LIMIT = 200;

export interface BpHistoryLoad {
  readings: HistoryReading[];
  requests: CorrectionRequest[];
  corrections: RecordCorrection[];
  /** True when requests could be read and this is the signed-in person's own record. */
  canRequest: boolean;
  /** The server could not be read and nothing is saved on the phone to show instead. */
  failed: boolean;
}

/** `failed` is true only when the server could not be read AND the copy on the phone is empty, so "no readings" is never shown for a failed read. */
async function loadServerReadings(patientId: string): Promise<{ rows: ServerBpRow[]; failed: boolean }> {
  try {
    const { data, error } = await supabase
      .from("vitals_readings")
      .select("id, systolic, diastolic, taken_at, source, client_reading_id")
      .eq("patient_id", patientId)
      .eq("vital_type", "blood_pressure")
      .order("taken_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    if (error) throw error;
    return { rows: data ?? [], failed: false };
  } catch {
    // Offline: the last copy pulled from the server (S06).
    const local = await readLocalRecords<ServerBpRow & { vital_type: string }>("vital", patientId, HISTORY_LIMIT).catch(() => []);
    const rows = local
      .filter((r) => r.vital_type === "blood_pressure")
      .map((r) => ({ ...r, source: r.source ?? null }))
      .sort((a, b) => b.taken_at.localeCompare(a.taken_at));
    return { rows, failed: rows.length === 0 };
  }
}

async function loadQueued(patientId: string): Promise<QueuedBp[]> {
  const items = await listOutbox("vital").catch(() => []);
  return items
    .filter((q) => q.subjectId === patientId && (q.payload as VitalReadingPayload).vital_type === "blood_pressure")
    .map((q) => {
      const p = q.payload as Extract<VitalReadingPayload, { vital_type: "blood_pressure" }>;
      return { clientId: q.clientId, state: q.state, systolic: p.systolic, diastolic: p.diastolic, clientRecordedAt: q.clientRecordedAt, supportCode: q.supportCode };
    });
}

/**
 * Requests are only readable for the signed-in person's own record (a request is
 * always filed under the caller, so someone acting for another person has none of
 * their own to show and cannot raise one for them). Failure to read leaves the
 * list without correction state and turns the ask off; it never hides a reading.
 */
async function loadRequests(userId: string): Promise<CorrectionRequest[] | null> {
  try {
    const { data, error } = await supabase
      .from("data_correction_requests")
      .select("id, status, requested_at, record_description, decision_note, resolution_note")
      .eq("patient_id", userId)
      .order("requested_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id,
      status: r.status as RequestStatus,
      requestedAt: r.requested_at,
      recordDescription: r.record_description,
      decisionNote: r.decision_note,
      resolutionNote: r.resolution_note,
    }));
  } catch {
    return null;
  }
}

async function loadCorrections(patientId: string): Promise<RecordCorrection[]> {
  try {
    const { data, error } = await supabase
      .from("record_corrections")
      .select("entity_id, corrected_at, changed_columns, old_values, new_values")
      .eq("patient_id", patientId)
      .eq("table_name", "vitals_readings")
      .order("corrected_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
    return (data ?? []).map((c) => ({
      entityId: c.entity_id,
      correctedAt: c.corrected_at,
      changedColumns: c.changed_columns,
      oldValues: obj(c.old_values),
      newValues: obj(c.new_values),
    }));
  } catch {
    return [];
  }
}

export async function loadBpHistory(patientId: string, userId: string): Promise<BpHistoryLoad> {
  const own = patientId === userId;
  const [server, queued, requests, corrections] = await Promise.all([
    loadServerReadings(patientId),
    loadQueued(patientId),
    own ? loadRequests(userId) : Promise.resolve(null),
    loadCorrections(patientId),
  ]);
  return {
    readings: mergeReadings(server.rows, queued),
    requests: requests ?? [],
    corrections,
    canRequest: own && requests !== null,
    failed: server.failed && queued.length === 0,
  };
}

export type AskResult = { ok: true } | { ok: false; reason: "empty" | "failed" };

/**
 * Raises a request for a care team member to review. The reading itself is not
 * touched. Needs a connection: a request is not queued offline, so the patient is
 * told it did not go rather than left to assume it did.
 */
export async function askForCorrection(
  organisationId: string,
  userId: string,
  reading: Pick<HistoryReading, "id" | "systolic" | "diastolic" | "takenAt">,
  whatIsWrong: string,
  requestedChange?: string,
): Promise<AskResult> {
  const wrong = whatIsWrong.trim().slice(0, 1000);
  if (!wrong) return { ok: false, reason: "empty" };
  try {
    await createCorrectionRequest(organisationId, userId, {
      recordDescription: buildRecordDescription(reading),
      whatIsWrong: wrong,
      requestedChange: requestedChange?.trim().slice(0, 1000) || undefined,
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
