import { getProposedConfig, mgDlToMmolL } from "@tarragon/shared";
import { deviceRedFlags, type DeviceRedRules } from "@tarragon/clinical";
import { supabase } from "./supabase";
import type { VitalReadingPayload } from "./api";
import { classifyBpLevel, type BpLevel } from "./bp-classification";
import { classifyGlucoseOffline, type GlucoseFlag } from "./glucose-red-flags";
import { enqueueVitalReading, flushPendingVitals, getPendingVitals } from "./offline-vitals-queue";
import { loadActiveThresholds } from "./threshold-sync";
import { pullChangesThrottled, readLocalRecords } from "./offline-store";
import { listOutbox } from "./outbox";

export interface BpReading {
  id: string;
  systolic: number;
  diastolic: number;
  takenAt: string;
  level: BpLevel;
  /** True for a reading saved on this phone that has not reached the server yet. */
  pending?: boolean;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

type BpRow = { id: string; systolic: number | null; diastolic: number | null; taken_at: string; client_reading_id?: string | null };

export async function loadRecentBpReadings(patientId: string, limit = 10): Promise<BpReading[]> {
  let rows: BpRow[];
  try {
    const { data, error } = await supabase
      .from("vitals_readings")
      .select("id, systolic, diastolic, taken_at, client_reading_id")
      .eq("patient_id", patientId)
      .eq("vital_type", "blood_pressure")
      .order("taken_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    rows = data ?? [];
    pullChangesThrottled(patientId);
  } catch {
    // Offline read (S06): the last copy pulled from the server.
    const local = await readLocalRecords<BpRow & { vital_type: string }>("vital", patientId, 200);
    rows = local
      .filter((r) => r.vital_type === "blood_pressure")
      .sort((a, b) => b.taken_at.localeCompare(a.taken_at))
      .slice(0, limit);
  }
  const synced: BpReading[] = rows
    .filter((r): r is BpRow & { systolic: number; diastolic: number } => r.systolic !== null && r.diastolic !== null)
    .map((r) => ({
      id: r.id,
      systolic: r.systolic,
      diastolic: r.diastolic,
      takenAt: r.taken_at,
      level: classifyBpLevel(r.systolic, r.diastolic),
    }));
  // Readings logged on this phone and not yet sent (S06): shown at their logged
  // time, marked pending, so an offline reading does not look lost.
  // Only rows still waiting: a rejected row is never retried, the banner reports
  // it, and the list must not promise it will arrive. A row whose id is already on
  // the server (flush in flight between insert and delete) is not shown twice.
  const serverIds = new Set(rows.map((r) => r.client_reading_id).filter((id): id is string => !!id));
  const queued: BpReading[] = (await listOutbox("vital").catch(() => []))
    .filter(
      (q) =>
        q.state === "pending" &&
        !serverIds.has(q.clientId) &&
        q.subjectId === patientId &&
        (q.payload as VitalReadingPayload).vital_type === "blood_pressure"
    )
    .map((q) => {
      const p = q.payload as Extract<VitalReadingPayload, { vital_type: "blood_pressure" }>;
      return {
        id: q.clientId,
        systolic: p.systolic,
        diastolic: p.diastolic,
        takenAt: q.clientRecordedAt,
        level: classifyBpLevel(p.systolic, p.diastolic),
        pending: true,
      };
    });
  return [...queued, ...synced]
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt))
    .slice(0, limit);
}

export interface SevenDayAverage {
  systolic: number;
  diastolic: number;
  readingCount: number;
}

export function computeSevenDayAverage(readings: BpReading[]): SevenDayAverage | null {
  const cutoff = Date.now() - SEVEN_DAYS_MS;
  const recent = readings.filter((r) => new Date(r.takenAt).getTime() >= cutoff);
  if (recent.length === 0) return null;
  const sys = Math.round(recent.reduce((sum, r) => sum + r.systolic, 0) / recent.length);
  const dia = Math.round(recent.reduce((sum, r) => sum + r.diastolic, 0) / recent.length);
  return { systolic: sys, diastolic: dia, readingCount: recent.length };
}

export interface LogVitalResult {
  error?: string;
  /** Set once the reading has been durably queued on-device, even if it
   * hasn't synced yet — the caller uses this to render a "pending sync"
   * state rather than losing the reading if `synced` is false. */
  clientReadingId?: string;
  /** True once this specific reading has actually reached the server (this
   * call's own immediate flush attempt succeeded on it), not just that some
   * flush ran — the background task / next screen open will keep retrying
   * otherwise. */
  synced?: boolean;
}

/** Writes to the on-device offline queue first (instant, zero-network — see
 * offline-vitals-queue.ts), then attempts an immediate flush so a patient
 * with signal sees near-instant sync. Goes through the same API path as
 * before either way, so a dangerous reading still triggers the same
 * BP-control/health-score reassessment a web-logged one does — see
 * apps/web/src/app/api/mobile/vitals/route.ts.
 *
 * beneficiaryProfileId, when set, logs this for the person whose account is
 * currently open (lib/acting.ts) rather than for the signed-in device
 * owner — the route re-checks the live 'manage' grant server-side. */
export async function logBpReading(
  systolic: number,
  diastolic: number,
  beneficiaryProfileId?: string
): Promise<LogVitalResult> {
  return enqueueAndSync({ vital_type: "blood_pressure", systolic, diastolic }, beneficiaryProfileId);
}

/** Glucose/weight/temperature/SpO2/pulse quick-log (MOBILE_APP_SPEC.md §2.2) —
 * same offline-first path and acting-for support as logBpReading. */
export async function logOtherVital(
  payload: Exclude<VitalReadingPayload, { vital_type: "blood_pressure" }>,
  beneficiaryProfileId?: string
): Promise<LogVitalResult> {
  return enqueueAndSync(payload, beneficiaryProfileId);
}

async function enqueueAndSync(
  payload: VitalReadingPayload,
  beneficiaryProfileId?: string
): Promise<LogVitalResult> {
  let queued;
  try {
    // Classification must never stand between a patient and a saved reading.
    const flag = await classifyVitalOffline(payload).catch(() => null);
    queued = await enqueueVitalReading(payload, beneficiaryProfileId, flag !== null);
  } catch {
    return { error: "Couldn't save the reading on this device. Try again." };
  }
  await flushPendingVitals();
  const stillPending = (await getPendingVitals()).some((v) => v.clientReadingId === queued.clientReadingId);
  return { clientReadingId: queued.clientReadingId, synced: !stillPending };
}

export interface OfflineVitalFlag {
  /** "emergency" takes over the screen with EmergencyGuidanceModal;
   * "urgent" is a same-day concern that only gets a lightweight inline
   * banner, no modal takeover — mirrors the severity split between the web
   * EmergencyAlert (full-screen) and an ordinary clinician_alerts badge. */
  severity: "emergency" | "urgent";
  detail: string;
}

/** BP/glucose-only, single-reading offline red-flag check (see
 * glucose-red-flags.ts's classifyGlucoseOffline for why it's a subset of the
 * full server-side classifier) — drives the native EmergencyGuidanceModal
 * immediately, with zero network, before the reading has even synced. */
export async function classifyVitalOffline(payload: VitalReadingPayload): Promise<OfflineVitalFlag | null> {
  const thresholds = await loadActiveThresholds();
  if (payload.vital_type === "blood_pressure") {
    const level = classifyBpLevel(payload.systolic, payload.diastolic, thresholds.bp);
    if (level === "emergency") {
      return {
        severity: "emergency",
        detail: `Blood pressure ${payload.systolic}/${payload.diastolic} mmHg is in the crisis range.`,
      };
    }
    if (level === "red") {
      return {
        severity: "urgent",
        detail: `Blood pressure ${payload.systolic}/${payload.diastolic} mmHg is high. Your care team will review it today.`,
      };
    }
    return null;
  }
  if (payload.vital_type === "glucose") {
    const mmolL = payload.glucose_unit === "mg_dl" ? mgDlToMmolL(payload.glucose_value) : payload.glucose_value;
    const flag: GlucoseFlag = classifyGlucoseOffline(mmolL, null, thresholds.glucose);
    if (flag.tier === "emergency") return { severity: "emergency", detail: flag.detail };
    if (flag.tier === "urgent") return { severity: "urgent", detail: flag.detail };
    return null;
  }
  // S65 (INV-06): pulse, SpO2 and temperature are classified on the phone too, from the same versioned thresholds the database uses
  // (vitals.device_red_rules, kept equal to the SQL classifiers by a parity test). Emergency band = the full-screen guidance; red band = the banner.
  if (payload.vital_type === "pulse" || payload.vital_type === "spo2" || payload.vital_type === "temperature") {
    const rules = getProposedConfig("vitals.device_red_rules").value as unknown as DeviceRedRules;
    const flags = deviceRedFlags(
      { pulse_bpm: payload.vital_type === "pulse" ? payload.pulse_bpm : null, spo2_pct: payload.vital_type === "spo2" ? payload.spo2_pct : null, temperature_c: payload.vital_type === "temperature" ? payload.temperature_c : null },
      rules,
    );
    const worst = flags[0];
    const label = payload.vital_type === "pulse" ? "Heart rate" : payload.vital_type === "spo2" ? "Oxygen level" : "Temperature";
    if (worst?.level === "emergency") return { severity: "emergency", detail: `${label} reading is in the danger range.` };
    if (worst?.level === "red") return { severity: "urgent", detail: `${label} reading is far from the safe range. Your care team will review it today.` };
  }
  return null;
}
