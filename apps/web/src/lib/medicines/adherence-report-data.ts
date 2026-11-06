import type { SupabaseClient } from "@supabase/supabase-js";
import { getProposedConfig, type Database } from "@tarragon/shared";
import { defaultsProfile, loadAnchors } from "@/lib/medication-schedule/anchor-profile";
import {
  addDays,
  buildAdherenceReport,
  groupLogsBySlot,
  lagosLocalDate,
  parseScheduleSpec,
  specFromLegacyTimes,
  type AdherenceConfig,
  type AdherenceMedicine,
  type AnchorProfile,
  type AdherenceReportWeek,
  type DoseLog,
  type LogSource,
  type LogStatus,
} from "@tarragon/medicines";

/**
 * Everything the patient's printed adherence report needs, read with the patient's own session (row level security
 * keeps it to her own medicines and doses). The numbers come from `buildAdherenceReport` in @tarragon/medicines,
 * the same formula the app and the care team's chart use (docs/design/S08x.md section 3).
 *
 * Failure is loud on purpose: a medicines or dose read that fails returns an error, never a report of zeros, because
 * a report that says "no doses due" for a read that failed would be a false statement on a document handed to a clinic.
 */
export interface AdherenceReportData {
  weeks: AdherenceReportWeek[];
  minDoses: number;
  generatedAtMs: number;
  hasScheduledMedicines: boolean;
}
export type AdherenceReportResult = { ok: true; data: AdherenceReportData } | { ok: false; error: string };

interface MedRow {
  id: string;
  schedule_times: unknown;
  schedule_spec: unknown;
  created_at: string | null;
  schedule_effective_from: string | null;
  /** T2-11d: when a prescription that starts on collection was first collected (one row or none). */
  medication_schedule_starts?: { starts_at: string } | { starts_at: string }[] | null;
  schedule_starts_on_collection?: boolean | null;
}
interface LogRow {
  medication_id: string | null;
  scheduled_for_date: string | null;
  scheduled_time: string | null;
  status: string | null;
  source: string | null;
  logged_at: string | null;
}

function uncollectedFallbackDays(): number {
  return (getProposedConfig("prescriptions.patient_supply_windows").value as { uncollected_reminder_fallback_days: number })
    .uncollected_reminder_fallback_days;
}

export function reportWeeksConfig(): number {
  const v = getProposedConfig("medicines.adherence_report").value as { weeks?: unknown };
  if (typeof v.weeks !== "number" || !Number.isInteger(v.weeks) || v.weeks < 1 || v.weeks > 26) {
    throw new Error("Config medicines.adherence_report.weeks must be a whole number from 1 to 26");
  }
  return v.weeks;
}

/** Turns the rows into the shapes the package reads. Exported for the drift test. */
export function toAdherenceMedicines(meds: readonly MedRow[], logs: readonly LogRow[], profile?: AnchorProfile): AdherenceMedicine[] {
  return meds.map((m) => {
    const parsed = m.schedule_spec != null ? parseScheduleSpec(m.schedule_spec, profile ?? defaultsProfile()) : null;
    const spec = parsed?.ok ? parsed.spec : specFromLegacyTimes(m.schedule_times);
    const mine = logs
      .filter((l) => l.medication_id === m.id && l.scheduled_for_date && l.scheduled_time && l.status && l.logged_at)
      .map((l) => ({
        status: l.status as LogStatus,
        source: (l.source ?? null) as LogSource | null,
        loggedAtMs: Date.parse(l.logged_at as string),
        date: l.scheduled_for_date as string,
        time: l.scheduled_time as string,
      }));
    const created = m.created_at ? Date.parse(m.created_at) : 0;
    const edited = m.schedule_effective_from ? Date.parse(m.schedule_effective_from) : 0;
    const startRow = Array.isArray(m.medication_schedule_starts) ? m.medication_schedule_starts[0] : m.medication_schedule_starts;
    const collectedAt = startRow?.starts_at ? Date.parse(startRow.starts_at) : NaN;
    const createdMs = Number.isFinite(created) ? created : 0;
    // T2-15: a prescription that starts on collection and has none yet starts at signing + the fallback days (prescription_supply_config)
    const collected = Number.isFinite(collectedAt)
      ? collectedAt
      : m.schedule_starts_on_collection && createdMs > 0
        ? createdMs + uncollectedFallbackDays() * 86_400_000
        : 0;
    const logMap: ReadonlyMap<string, readonly DoseLog[]> = groupLogsBySlot(mine);
    return { id: m.id, spec, logs: logMap, activeFromMs: Math.max(Number.isFinite(created) ? created : 0, Number.isFinite(edited) ? edited : 0, Number.isFinite(collected) ? collected : 0) };
  });
}

const PAGE = 1000;

/**
 * Every dose row since a date. The API caps one response at 1000 rows, and a silently cut list would turn answered
 * doses into "no record" in a report handed to a clinic, so this pages until a short page comes back.
 */
async function fetchAllLogs(
  supabase: SupabaseClient<Database>,
  patientId: string,
  since: string,
): Promise<{ data: LogRow[]; error: { message: string } | null }> {
  const out: LogRow[] = [];
  for (let from = 0; from < 100_000; from += PAGE) {
    const { data, error } = await supabase
      .from("medication_logs_latest_per_slot")
      .select("medication_id, scheduled_for_date, scheduled_time, status, source, logged_at")
      .eq("patient_id", patientId)
      .gte("scheduled_for_date", since)
      .order("scheduled_for_date")
      .order("medication_id")
      .order("scheduled_time")
      .range(from, from + PAGE - 1);
    if (error) return { data: [], error };
    out.push(...((data ?? []) as LogRow[]));
    if ((data ?? []).length < PAGE) return { data: out, error: null };
  }
  return { data: [], error: { message: "too many dose rows to read" } };
}

/** The medicines (with their dose logs) and the active rules, as the adherence formula reads them. */
export type AdherenceInputs =
  | { ok: true; medicines: AdherenceMedicine[]; cfg: AdherenceConfig }
  | { ok: false; error: string };

/**
 * Reads everything the adherence formula needs for the last `days` Lagos days (plus one), with the caller's own session.
 * Shared by the printed report and the Medications page's doses chart, so both always show the same numbers. Loud on
 * failure: a read that fails returns an error, never an empty list that would read as "nothing was due".
 */
export async function loadAdherenceInputs(
  supabase: SupabaseClient<Database>,
  patientId: string,
  nowMs: number,
  days: number,
): Promise<AdherenceInputs> {
  const since = addDays(lagosLocalDate(nowMs), -(days + 1));
  const [cfgRes, medsRes, logsRes, anchors] = await Promise.all([
    supabase
      .from("medicine_config")
      .select("missed_after_minutes, adherence_min_doses, adherence_threshold_percent")
      .eq("is_active", true)
      .maybeSingle(),
    supabase
      .from("medications")
      .select("id, schedule_times, schedule_spec, created_at, schedule_effective_from, schedule_starts_on_collection, medication_schedule_starts(starts_at)")
      .eq("patient_id", patientId)
      .eq("is_active", true)
      .is("superseded_at", null),
    fetchAllLogs(supabase, patientId, since),
    // S08z: doses tied to the patient's day are worked out from their own anchor times and day shifts, as they were on each date.
    loadAnchors(supabase, patientId),
  ]);
  const failure = cfgRes.error ?? medsRes.error ?? logsRes.error;
  if (failure) return { ok: false, error: failure.message };
  const cfg = cfgRes.data;
  if (!cfg) return { ok: false, error: "The medicine rules are not available right now." };

  const meds = (medsRes.data ?? []) as MedRow[];
  // A report on doses tied to the day, worked out from the proposed starting times because the person's own could not be read, would
  // put the wrong times on a document handed to a clinic. Refuse rather than print it.
  const hasAnchored = meds.some((m) => {
    const spec = m.schedule_spec as { anchored?: unknown } | null;
    return Array.isArray(spec?.anchored) && spec.anchored.length > 0;
  });
  if (hasAnchored && !anchors.loaded) return { ok: false, error: "Your daily times could not be read just now." };
  return {
    ok: true,
    medicines: toAdherenceMedicines(meds, (logsRes.data ?? []) as LogRow[], anchors.profile),
    cfg: {
      windowDays: 7,
      minDoses: cfg.adherence_min_doses,
      missedAfterMinutes: cfg.missed_after_minutes,
      thresholdPercent: cfg.adherence_threshold_percent,
    },
  };
}

export async function loadAdherenceReport(
  supabase: SupabaseClient<Database>,
  patientId: string,
  nowMs: number = Date.now(),
  /** The doctor summary PDF covers the period the patient picked; the printed adherence report keeps its configured length. */
  weeksOverride?: number,
): Promise<AdherenceReportResult> {
  const weeksCount = weeksOverride ?? reportWeeksConfig();
  if (!Number.isInteger(weeksCount) || weeksCount < 1 || weeksCount > 26) return { ok: false, error: "The report period is not valid." };
  const inputs = await loadAdherenceInputs(supabase, patientId, nowMs, weeksCount * 7);
  if (!inputs.ok) return inputs;
  const weeks = buildAdherenceReport(inputs.medicines, nowMs, inputs.cfg, weeksCount);
  return {
    ok: true,
    data: { weeks, minDoses: inputs.cfg.minDoses, generatedAtMs: nowMs, hasScheduledMedicines: weeks.some((w) => w.due > 0) },
  };
}
