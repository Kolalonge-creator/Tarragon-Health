import { supabase } from "./supabase";
import type { Tables } from "@tarragon/shared";

/** 'unconfirmed' is written server-side only, by private.mark_unconfirmed_doses()
 * (the grace-period cron, see 20260826213713_medication_logs_reason_codes_and_
 * unconfirmed_status.sql) when a scheduled dose has gone silent long enough —
 * distinct from 'pending', which is this app's own client-side fallback for a
 * slot with no log row at all yet. Never write 'unconfirmed' from the app. */
export type DoseStatus = "pending" | "taken" | "missed" | "skipped" | "unconfirmed";

/** Mirrors apps/web/src/lib/validation/medication-logs.ts's
 * MEDICATION_LOG_REASON_CODES — duplicated for the same reason DoseStatus is
 * (no shared package to pull from); keep the DB CHECK constraint, the web
 * copy, and this one in sync if the vocabulary ever changes. 'felt_fine' is
 * the one deliberate-skip code — logDose's caller maps it to status='skipped'
 * instead of 'missed'. */
export const MEDICATION_LOG_REASON_CODES = [
  "ran_out",
  "side_effects",
  "felt_fine",
  "forgot",
  "cost",
  "other",
] as const;
export type MedicationLogReasonCode = (typeof MEDICATION_LOG_REASON_CODES)[number];

export interface DoseChecklistItem {
  medicationId: string;
  drugName: string;
  time: string;
  status: DoseStatus;
}

type MedicationForChecklist = Pick<Tables<"medications">, "id" | "drug_name" | "schedule_times">;
type LogForChecklist = Pick<Tables<"medication_logs">, "medication_id" | "scheduled_time" | "status">;

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

export async function loadTodaysDoses(patientId: string): Promise<DoseChecklistItem[]> {
  const today = todayIsoDate();
  const [{ data: medications }, { data: logs }] = await Promise.all([
    supabase
      .from("medications")
      .select("id, drug_name, schedule_times")
      .eq("patient_id", patientId)
      .eq("is_active", true),
    supabase
      .from("medication_logs")
      .select("medication_id, scheduled_time, status")
      .eq("patient_id", patientId)
      .eq("scheduled_for_date", today),
  ]);
  return buildTodaysDoseChecklist(medications ?? [], logs ?? []);
}

/**
 * Select-then-upsert against the (medication_id, scheduled_for_date,
 * scheduled_time) partial unique index — mirrors useLogDose in
 * apps/web/src/lib/queries/medications.ts exactly (a bare client insert is
 * safe here: the adherence-streak/alert side effect is a DB trigger on
 * medication_logs, not app code, so it fires the same way regardless of
 * which client wrote the row).
 */
export async function logDose(
  patientId: string,
  organisationId: string,
  item: DoseChecklistItem,
  // 'unconfirmed' is server-written only (see the DoseStatus comment above) —
  // never a status the app itself logs.
  status: Exclude<DoseStatus, "pending" | "unconfirmed">,
  reasonCode?: MedicationLogReasonCode
): Promise<{ error?: string }> {
  const scheduled_for_date = todayIsoDate();
  const { data: existing } = await supabase
    .from("medication_logs")
    .select("id")
    .eq("medication_id", item.medicationId)
    .eq("scheduled_for_date", scheduled_for_date)
    .eq("scheduled_time", item.time)
    .maybeSingle();

  const { error } = existing
    ? await supabase
        .from("medication_logs")
        .update({ status, reason_code: reasonCode ?? null, logged_at: new Date().toISOString() })
        .eq("id", existing.id)
    : await supabase.from("medication_logs").insert({
        medication_id: item.medicationId,
        scheduled_time: item.time,
        scheduled_for_date,
        status,
        reason_code: reasonCode ?? null,
        patient_id: patientId,
        organisation_id: organisationId,
      });
  return error ? { error: error.message } : {};
}
