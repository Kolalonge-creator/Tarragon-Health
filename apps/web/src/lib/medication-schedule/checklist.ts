import type { Tables } from "@tarragon/shared";
import { lagosLocalDate, parseScheduleSpec, slotsOn, specFromLegacyTimes } from "@tarragon/medicines";

export type DoseStatus = "pending" | "taken" | "missed" | "skipped" | "delayed" | "not_available";

export type DoseChecklistItem = {
  medicationId: string;
  drugName: string;
  time: string;
  status: DoseStatus;
};

type MedicationForChecklist = Pick<Tables<"medications">, "id" | "drug_name" | "schedule_times"> & {
  /** S08: the structured schedule (every few days, certain weekdays, step-down). Absent or unreadable means the plain list of daily times. */
  schedule_spec?: unknown;
};
// Sourced from medication_logs_latest_per_slot (20260830224528), not the raw
// append-only table — a view's columns are nullable regardless of the
// underlying column, hence the broader types here versus medication_logs'.
type LogForChecklist = Pick<
  Tables<"medication_logs_latest_per_slot">,
  "medication_id" | "scheduled_time" | "status"
>;

/** `logs` is expected to already be scoped to today's date (Africa/Lagos) by the caller. */
export function buildTodaysDoseChecklist(
  medications: MedicationForChecklist[],
  logs: LogForChecklist[],
  nowMs: number = Date.now()
): DoseChecklistItem[] {
  const today = lagosLocalDate(nowMs);
  const items: DoseChecklistItem[] = [];
  for (const medication of medications) {
    const parsed = medication.schedule_spec != null ? parseScheduleSpec(medication.schedule_spec) : null;
    const spec = parsed?.ok ? parsed.spec : specFromLegacyTimes(medication.schedule_times);
    for (const { time } of slotsOn(spec, today)) {
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
