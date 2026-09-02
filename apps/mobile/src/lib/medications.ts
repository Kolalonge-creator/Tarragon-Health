import { supabase } from "./supabase";
import type { Tables } from "@tarragon/shared";

export type DoseStatus = "pending" | "taken" | "missed" | "skipped";

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
  status: Exclude<DoseStatus, "pending">
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
        .update({ status, logged_at: new Date().toISOString() })
        .eq("id", existing.id)
    : await supabase.from("medication_logs").insert({
        medication_id: item.medicationId,
        scheduled_time: item.time,
        scheduled_for_date,
        status,
        patient_id: patientId,
        organisation_id: organisationId,
      });
  return error ? { error: error.message } : {};
}
