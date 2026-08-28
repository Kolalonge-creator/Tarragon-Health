import type { Tables } from "@tarragon/shared";

// Mirrors medicationLogStatusValues (13.5) plus the checklist-only "pending"
// state for a slot with no log yet.
export type DoseStatus =
  | "pending"
  | "taken"
  | "missed"
  | "skipped"
  | "unable_to_obtain"
  | "vomited"
  | "side_effect"
  | "other";

export type DoseChecklistItem = {
  medicationId: string;
  drugName: string;
  time: string;
  status: DoseStatus;
};

type MedicationForChecklist = Pick<Tables<"medications">, "id" | "drug_name" | "schedule_times">;
// status is intentionally a plain string here, not the (stale, pre-13.5)
// generated medication_log_status union — buildTodaysDoseChecklist already
// defensively casts an unrecognised value through DoseStatus below.
type LogForChecklist = { medication_id: string; scheduled_time: string | null; status: string };

/** `logs` is expected to already be scoped to today's date by the caller. */
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
      const log = logs.find(
        (l) => l.medication_id === medication.id && l.scheduled_time === time
      );
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
