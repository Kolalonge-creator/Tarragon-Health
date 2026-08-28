import { describe, expect, it } from "@jest/globals";
import { buildWeeklyAdherenceSummary } from "./weekly-adherence";
import type { MedicationLogStatus } from "@/lib/supabase/pending-schema-overrides";

describe("buildWeeklyAdherenceSummary", () => {
  const medA = { id: "med-a", drug_name: "Lisinopril", schedule_times: ["08:00"] };
  const medB = { id: "med-b", drug_name: "Metformin", schedule_times: ["08:00", "20:00"] };

  it("computes taken/expected/percentage for a single medication", () => {
    const logs: { medication_id: string; status: MedicationLogStatus }[] = [
      { medication_id: "med-a", status: "taken" },
      { medication_id: "med-a", status: "taken" },
      { medication_id: "med-a", status: "missed" },
    ];
    const result = buildWeeklyAdherenceSummary([medA], logs);
    expect(result.medications).toEqual([
      { medicationId: "med-a", drugName: "Lisinopril", takenCount: 2, expectedCount: 7, percentage: 29 },
    ]);
    expect(result.overallTakenCount).toBe(2);
    expect(result.overallExpectedCount).toBe(7);
    expect(result.overallPercentage).toBe(29);
  });

  it("aggregates across multiple medications with different daily counts", () => {
    const logs: { medication_id: string; status: MedicationLogStatus }[] = [
      { medication_id: "med-a", status: "taken" },
      { medication_id: "med-b", status: "taken" },
      { medication_id: "med-b", status: "taken" },
    ];
    const result = buildWeeklyAdherenceSummary([medA, medB], logs);
    // med-a: 1/7, med-b: 2/14 -> overall 3/21
    expect(result.overallTakenCount).toBe(3);
    expect(result.overallExpectedCount).toBe(21);
    expect(result.overallPercentage).toBe(14);
  });

  it("ignores logs for a different medication", () => {
    const result = buildWeeklyAdherenceSummary(
      [medA],
      [{ medication_id: "med-other", status: "taken" }]
    );
    expect(result.medications[0].takenCount).toBe(0);
  });

  it("returns a null percentage for a medication with no scheduled times", () => {
    const result = buildWeeklyAdherenceSummary(
      [{ id: "med-c", drug_name: "As-needed ibuprofen", schedule_times: [] }],
      []
    );
    expect(result.medications[0].percentage).toBeNull();
    expect(result.overallPercentage).toBeNull();
  });

  it("only counts 'taken' logs toward the numerator, not missed/skipped", () => {
    const logs: { medication_id: string; status: MedicationLogStatus }[] = [
      { medication_id: "med-a", status: "missed" },
      { medication_id: "med-a", status: "skipped" },
      { medication_id: "med-a", status: "unable_to_obtain" },
    ];
    const result = buildWeeklyAdherenceSummary([medA], logs);
    expect(result.medications[0].takenCount).toBe(0);
  });
});
