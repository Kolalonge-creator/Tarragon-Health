import { supabase } from "./supabase";
import type { Tables } from "@tarragon/shared";

/**
 * Shared result shape for the native read-path lib functions (overview.ts
 * imports it from here). A failed clinical query must be distinguishable
 * from a genuinely empty one — destructuring `{ data }` and discarding the
 * error made an RLS denial or a network drop render as "Active meds 0" /
 * "No scheduled doses today", which is a false clinical claim, not a UI nit.
 */
export type QueryResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type DoseStatus = "pending" | "taken" | "missed" | "skipped";

export interface DoseChecklistItem {
  medicationId: string;
  drugName: string;
  time: string;
  status: DoseStatus;
}

type MedicationForChecklist = Pick<Tables<"medications">, "id" | "drug_name" | "schedule_times">;
// Sourced from medication_logs_latest_per_slot (20260830224528), not the raw
// append-only table — a view's columns are nullable regardless of the
// underlying column, hence the broader types here versus medication_logs'.
type LogForChecklist = Pick<
  Tables<"medication_logs_latest_per_slot">,
  "medication_id" | "scheduled_time" | "status"
>;

/** Mirrors apps/web/src/lib/medication-schedule/checklist.ts's buildTodaysDoseChecklist —
 * duplicated rather than imported since apps/web isn't a shared package the
 * mobile app can pull from; keep the two in sync if the scheduling rule changes. */
export function buildTodaysDoseChecklist(
  medications: MedicationForChecklist[],
  logs: LogForChecklist[]
): DoseChecklistItem[] {
  const items: DoseChecklistItem[] = [];
  for (const medication of medications) {
    const times = Array.isArray(medication.schedule_times)
      ? (medication.schedule_times as string[])
      : [];
    for (const time of times) {
      const log = logs.find((l) => l.medication_id === medication.id && l.scheduled_time === time);
      items.push({
        medicationId: medication.id,
        drugName: medication.drug_name,
        time,
        status: (log?.status as DoseStatus | undefined) ?? "pending",
      });
    }
  }
  return items.sort((a, b) => a.time.localeCompare(b.time));
}

/** Patient-local (Africa/Lagos) calendar date, per CLAUDE.md's fixed timezone rule. */
export function todayIsoDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}

/**
 * medication_logs is append-only (20260830224528): a slot can carry more
 * than one row once a dose is corrected. medication_logs_latest_per_slot
 * keeps only the latest row per (medication, date, time) — freeform/
 * as-needed logs (no scheduled slot) are never deduped, each stands alone.
 */
export async function loadTodaysDoses(patientId: string): Promise<QueryResult<DoseChecklistItem[]>> {
  const today = todayIsoDate();
  try {
    const [medsRes, logsRes] = await Promise.all([
      supabase
        .from("medications")
        .select("id, drug_name, schedule_times")
        .eq("patient_id", patientId)
        .eq("is_active", true),
      supabase
        .from("medication_logs_latest_per_slot")
        .select("medication_id, scheduled_time, status")
        .eq("patient_id", patientId)
        .eq("scheduled_for_date", today),
    ]);
    const failure = medsRes.error ?? logsRes.error;
    if (failure) return { ok: false, error: failure.message };
    return { ok: true, data: buildTodaysDoseChecklist(medsRes.data ?? [], logsRes.data ?? []) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Append-only (20260830224528): every dose action is a new row, never an
 * update of a previous one — mirrors useLogDose in
 * apps/web/src/lib/queries/medications.ts exactly (a bare client insert is
 * safe here: the adherence-streak/alert side effect is a DB trigger on
 * medication_logs, not app code, so it fires the same way regardless of
 * which client wrote the row).
 */
export async function logDose(
  patientId: string,
  organisationId: string,
  item: DoseChecklistItem,
  status: Exclude<DoseStatus, "pending">
): Promise<{ error?: string }> {
  const scheduled_for_date = todayIsoDate();
  const { error } = await supabase.from("medication_logs").insert({
    medication_id: item.medicationId,
    scheduled_time: item.time,
    scheduled_for_date,
    status,
    patient_id: patientId,
    organisation_id: organisationId,
  });
  return error ? { error: error.message } : {};
}
