import { describe, expect, it } from "@jest/globals";
import { buildTodaysDoseChecklist } from "./checklist";

describe("buildTodaysDoseChecklist", () => {
  const medication = {
    id: "med-1",
    drug_name: "Lisinopril",
    schedule_times: ["20:00", "08:00"],
  };

  it("returns one pending item per schedule_times slot, sorted by time", () => {
    const result = buildTodaysDoseChecklist([medication], []);
    expect(result).toEqual([
      { medicationId: "med-1", drugName: "Lisinopril", time: "08:00", status: "pending" },
      { medicationId: "med-1", drugName: "Lisinopril", time: "20:00", status: "pending" },
    ]);
  });

  it("reflects the logged status for a matching slot", () => {
    const result = buildTodaysDoseChecklist(
      [medication],
      [{ medication_id: "med-1", scheduled_time: "08:00", status: "taken" }]
    );
    expect(result.find((i) => i.time === "08:00")?.status).toBe("taken");
    expect(result.find((i) => i.time === "20:00")?.status).toBe("pending");
  });

  it("ignores logs for a different medication", () => {
    const result = buildTodaysDoseChecklist(
      [medication],
      [{ medication_id: "med-other", scheduled_time: "08:00", status: "taken" }]
    );
    expect(result.find((i) => i.time === "08:00")?.status).toBe("pending");
  });

  it("returns no items for a medication with no schedule_times", () => {
    const result = buildTodaysDoseChecklist(
      [{ id: "med-2", drug_name: "Metformin", schedule_times: [] }],
      []
    );
    expect(result).toEqual([]);
  });

  it("handles a non-array schedule_times value defensively", () => {
    const result = buildTodaysDoseChecklist(
      [{ id: "med-3", drug_name: "Amlodipine", schedule_times: null }],
      []
    );
    expect(result).toEqual([]);
  });
});
