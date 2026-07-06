import type { Tables } from "@tarragon/shared";

export type DoseStatus = "pending" | "taken" | "missed" | "skipped";

export type DoseChecklistItem = {
  medicationId: string;
  drugName: string;
  time: string;
  status: DoseStatus;
};

type MedicationForChecklist = Pick<Tables<"medications">, "id" | "drug_name" | "schedule_times">;
type LogForChecklist = Pick<Tables<"medication_logs">, "medication_id" | "scheduled_time" | "status">;

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
