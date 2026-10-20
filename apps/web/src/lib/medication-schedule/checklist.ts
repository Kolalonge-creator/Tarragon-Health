import type { Tables } from "@tarragon/shared";
import { lagosLocalDate, parseScheduleSpec, slotsOn, specFromLegacyTimes, type AnchoredDose, type AnchorProfile } from "@tarragon/medicines";
import { defaultsProfile } from "./anchor-profile";

export type DoseStatus = "pending" | "taken" | "missed" | "skipped" | "delayed" | "not_available";

export type DoseChecklistItem = {
  medicationId: string;
  drugName: string;
  time: string;
  status: DoseStatus;
  /** S08z: set when this dose is tied to a daily anchor (a meal, waking, a prayer, bedtime), so the list can say so in plain words. */
  anchored?: AnchoredDose;
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

/** True when any of these medicines has doses tied to the patient's day (S08z), so their times depend on the patient's own anchor times. */
export function hasAnchoredDoses(medications: readonly { schedule_spec?: unknown }[]): boolean {
  return medications.some((m) => {
    const spec = m.schedule_spec as { anchored?: unknown } | null | undefined;
    return Array.isArray(spec?.anchored) && spec.anchored.length > 0;
  });
}

/** `logs` is expected to already be scoped to today's date (Africa/Lagos) by the caller. */
export function buildTodaysDoseChecklist(
  medications: MedicationForChecklist[],
  logs: LogForChecklist[],
  nowMs: number = Date.now(),
  /** The patient's anchor times and day shifts. Without one, anchored doses resolve at the proposed starting times. */
  profile: AnchorProfile = defaultsProfile()
): DoseChecklistItem[] {
  const today = lagosLocalDate(nowMs);
  const items: DoseChecklistItem[] = [];
  for (const medication of medications) {
    const parsed = medication.schedule_spec != null ? parseScheduleSpec(medication.schedule_spec, profile) : null;
    const spec = parsed?.ok ? parsed.spec : specFromLegacyTimes(medication.schedule_times);
    for (const { time, anchored } of slotsOn(spec, today)) {
      const log = logs.find(
        (l) => l.medication_id === medication.id && l.scheduled_time === time
      );
      items.push({
        medicationId: medication.id,
        drugName: medication.drug_name,
        time,
        status: (log?.status as DoseStatus | undefined) ?? "pending",
        ...(anchored ? { anchored } : {}),
      });
    }
  }
  return items.sort((a, b) => a.time.localeCompare(b.time));
}
