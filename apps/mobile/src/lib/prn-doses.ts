import AsyncStorage from "@react-native-async-storage/async-storage";
import { checkPrnDose, lagosLocalDate, parseScheduleSpec, type PrnBreach, type PrnLimits } from "@tarragon/medicines";
import { enqueue, flushOutbox, listOutbox, type DosePayload } from "./outbox";
import { readLocalMedications, readLocalRecords } from "./offline-store";
import { supabase } from "./supabase";

/**
 * As-needed (PRN) medicines on the phone (S08x, decision C7: approved text, not signed).
 *
 * "I took one" ALWAYS records the dose (on the phone first, then sent). The limit check only decides whether to show
 * the notice "This is sooner than your care plan says. Check with your care team before taking another"; it never
 * blocks, delays or edits the log, and nothing here ever suggests a double dose.
 *
 * Limits are set only by a clinician, per medicine, and there are no defaults. They are cached on the phone so an
 * offline phone still warns; a late-synced dose is judged again on the server by the same rule, so the care team's
 * record never depends on this phone having had the limits.
 */
export interface AsNeededMedicine {
  id: string;
  drugName: string;
  /** What the care team set, or null when none is set. */
  limits: PrnLimits | null;
  /** True when the limits could not be read and none are remembered: "no limits" would be a guess, so the screen says so. */
  limitsUnknown?: boolean;
}

interface MedRow {
  id: string;
  drug_name: string;
  schedule_spec?: unknown;
}

const LIMITS_KEY = (patientId: string) => `prn-limits:${patientId}`;
const GUARD_KEY = "prn-limits:guard-open";
const LOOKBACK_MS = 36 * 60 * 60 * 1000;

type LimitsMap = Record<string, PrnLimits>;

async function readCachedLimits(patientId: string): Promise<LimitsMap | null> {
  try {
    const raw = await AsyncStorage.getItem(LIMITS_KEY(patientId));
    return raw === null ? null : (JSON.parse(raw) as LimitsMap);
  } catch {
    return null;
  }
}

async function loadLimits(patientId: string): Promise<LimitsMap | null> {
  try {
    const { data, error } = await supabase
      .from("medication_prn_limits")
      .select("medication_id, min_gap_minutes, daily_max")
      .eq("patient_id", patientId);
    if (error) throw error;
    const map: LimitsMap = {};
    for (const r of data ?? []) map[r.medication_id] = { minGapMinutes: r.min_gap_minutes, dailyMax: r.daily_max };
    await AsyncStorage.setItem(LIMITS_KEY(patientId), JSON.stringify(map)).catch(() => undefined);
    return map;
  } catch {
    // Offline or refused: use what this phone last saw. Nothing remembered is "unknown", not "none".
    return readCachedLimits(patientId);
  }
}

/**
 * Whether the care team's go-live switch for this check is open for this person. An explicit "closed" hides the notice
 * (the server records no flag then either); an unreadable answer with nothing cached shows it, because a missing warning
 * is the worse mistake.
 */
export async function prnNoticeEnabled(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("go_live_guard_is_open", { p_key: "prn_limits" });
    if (error) throw error;
    await AsyncStorage.setItem(GUARD_KEY, data === true ? "1" : "0").catch(() => undefined);
    return data === true;
  } catch {
    return (await AsyncStorage.getItem(GUARD_KEY).catch(() => null)) !== "0";
  }
}

export async function loadAsNeededMedicines(patientId: string): Promise<AsNeededMedicine[]> {
  let rows: MedRow[] | null = null;
  try {
    const { data, error } = await supabase
      .from("medications")
      .select("id, drug_name, schedule_spec")
      .eq("patient_id", patientId)
      .eq("is_active", true)
      .is("superseded_at", null);
    if (!error && data) rows = data as MedRow[];
  } catch {
    // offline: fall through to the last copy on this phone
  }
  if (!rows) rows = await readLocalMedications<MedRow>(patientId);
  const asNeeded = rows.filter((m) => {
    if (m.schedule_spec == null) return false;
    const parsed = parseScheduleSpec(m.schedule_spec);
    return parsed.ok && parsed.spec.kind === "as_needed";
  });
  if (asNeeded.length === 0) return [];
  const limits = await loadLimits(patientId);
  return asNeeded.map((m) => ({ id: m.id, drugName: m.drug_name, limits: limits?.[m.id] ?? null, limitsUnknown: limits === null }));
}

/** Times of the other as-needed doses of this medicine in the last day and a half: the server's, the phone's mirror, and any not yet sent. */
async function priorDoseTimes(patientId: string, medicationId: string, nowMs: number, excludeClientId?: string): Promise<number[]> {
  const since = new Date(nowMs - LOOKBACK_MS).toISOString();
  const times: number[] = [];
  try {
    const { data, error } = await supabase
      .from("medication_logs_latest_per_slot")
      .select("logged_at, status")
      .eq("patient_id", patientId)
      .eq("medication_id", medicationId)
      .is("scheduled_time", null)
      .in("status", ["taken", "delayed"])
      .gte("logged_at", since);
    if (error) throw error;
    for (const r of data ?? []) if (r.logged_at) times.push(Date.parse(r.logged_at));
  } catch {
    const mirrored = await readLocalRecords<{ medication_id: string; scheduled_time: string | null; status: string; logged_at?: string }>("dose", patientId, 200).catch(() => []);
    for (const r of mirrored) {
      if (r.medication_id === medicationId && r.scheduled_time == null && (r.status === "taken" || r.status === "delayed") && r.logged_at) {
        times.push(Date.parse(r.logged_at));
      }
    }
  }
  for (const row of await listOutbox("dose").catch(() => [])) {
    const p = row.payload as DosePayload;
    if (row.clientId !== excludeClientId && row.subjectId === patientId && p.medication_id === medicationId && p.scheduled_time == null && (p.status === "taken" || p.status === "delayed")) {
      times.push(Date.parse(row.clientRecordedAt));
    }
  }
  return times.filter((t) => Number.isFinite(t));
}

export interface AsNeededResult {
  /** The dose is on the phone (and sent if there is signal). False only when it could not be saved at all. */
  saved: boolean;
  synced: boolean;
  /** Which limits this dose was over, judged on the phone. Empty when none, or when no limits are known. */
  breaches: PrnBreach[];
}

/**
 * Record "I took one" now. The dose is saved first; the check runs on what the phone knows and never delays or stops the save.
 */
export async function logAsNeededDose(
  patientId: string,
  organisationId: string,
  medication: AsNeededMedicine,
  nowMs: number = Date.now(),
): Promise<AsNeededResult> {
  // 1. Save on the phone FIRST. Nothing below can delay or lose it: the checks read the network, which may hang.
  let queuedId: string;
  try {
    const row = await enqueue({
      kind: "dose",
      subjectId: patientId,
      payload: {
        medication_id: medication.id,
        scheduled_time: null,
        scheduled_for_date: lagosLocalDate(nowMs),
        status: "taken",
        organisation_id: organisationId,
        reason: null,
      },
      recordedAt: new Date(nowMs).toISOString(),
    });
    queuedId = row.clientId;
  } catch {
    return { saved: false, synced: false, breaches: [] };
  }
  // 2. Judge it against the other doses (not itself), for the notice only.
  let breaches: PrnBreach[] = [];
  if (medication.limits) {
    try {
      if (await prnNoticeEnabled()) {
        breaches = checkPrnDose(medication.limits, await priorDoseTimes(patientId, medication.id, nowMs, queuedId), nowMs);
      }
    } catch {
      breaches = [];
    }
  }
  // 3. Send.
  await flushOutbox().catch(() => undefined);
  const stillThere = (await listOutbox("dose").catch(() => [])).find((row) => row.clientId === queuedId);
  return { saved: true, synced: !stillThere, breaches };
}
