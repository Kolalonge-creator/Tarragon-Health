import type { Tables } from "@tarragon/shared";
import type { MedicationLogStatus } from "@/lib/supabase/pending-schema-overrides";

export interface WeeklyAdherenceMedicationSummary {
  medicationId: string;
  drugName: string;
  takenCount: number;
  expectedCount: number;
  /** null when the medication has no scheduled dose times to measure against. */
  percentage: number | null;
}

export interface WeeklyAdherenceSummary {
  medications: WeeklyAdherenceMedicationSummary[];
  overallTakenCount: number;
  overallExpectedCount: number;
  overallPercentage: number | null;
}

type MedicationForWeeklyAdherence = Pick<Tables<"medications">, "id" | "drug_name" | "schedule_times">;
type LogForWeeklyAdherence = { medication_id: string; status: MedicationLogStatus };

const WINDOW_DAYS = 7;

/**
 * 13.7's patient adherence dashboard ("Medication A — 6/7 doses… Overall
 * adherence 93%"). `logs` is expected to already be scoped to the trailing 7
 * days by the caller (same convention as buildTodaysDoseChecklist scoping to
 * today). expectedCount is a simple scheduled-times-per-day × 7 estimate —
 * it doesn't account for a medication started mid-week, matching the
 * lightweight, at-a-glance nature of the spec's own example rather than
 * claiming a precise clinical adherence metric.
 */
export function buildWeeklyAdherenceSummary(
  medications: MedicationForWeeklyAdherence[],
  logs: LogForWeeklyAdherence[]
): WeeklyAdherenceSummary {
  const medications_ = medications.map((medication): WeeklyAdherenceMedicationSummary => {
    const times = Array.isArray(medication.schedule_times)
      ? (medication.schedule_times as string[])
      : [];
    const expectedCount = times.length * WINDOW_DAYS;
    const takenCount = logs.filter(
      (log) => log.medication_id === medication.id && log.status === "taken"
    ).length;
    return {
      medicationId: medication.id,
      drugName: medication.drug_name,
      takenCount,
      expectedCount,
      percentage: expectedCount > 0 ? Math.round((takenCount / expectedCount) * 100) : null,
    };
  });

  const overallExpectedCount = medications_.reduce((sum, m) => sum + m.expectedCount, 0);
  const overallTakenCount = medications_.reduce((sum, m) => sum + m.takenCount, 0);

  return {
    medications: medications_,
    overallTakenCount,
    overallExpectedCount,
    overallPercentage:
      overallExpectedCount > 0 ? Math.round((overallTakenCount / overallExpectedCount) * 100) : null,
  };
}
