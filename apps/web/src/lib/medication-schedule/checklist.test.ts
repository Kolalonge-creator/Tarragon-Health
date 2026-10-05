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

  it.each(["skipped", "delayed", "not_available"] as const)(
    "reflects a %s logged status for a matching slot",
    (status) => {
      const result = buildTodaysDoseChecklist(
        [medication],
        [{ medication_id: "med-1", scheduled_time: "08:00", status }]
      );
      expect(result.find((i) => i.time === "08:00")?.status).toBe(status);
    }
  );

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

  describe("structured schedules (S08)", () => {
    const monday = Date.parse("2026-10-05T10:00:00Z"); // 11:00 in Lagos
    const base = { startDate: null, endDate: null, foodNote: null };

    it("lists an every-other-day medicine only on its days", () => {
      const med = {
        id: "a",
        drug_name: "A",
        schedule_times: ["09:00"],
        schedule_spec: { ...base, kind: "every_n_days", times: ["09:00"], intervalDays: 2, anchorDate: "2026-10-01" },
      };
      expect(buildTodaysDoseChecklist([med], [], monday)).toHaveLength(1);
      expect(buildTodaysDoseChecklist([med], [], monday + 86_400_000)).toEqual([]);
    });

    it("lists a weekday medicine only on its weekdays and leaves as-needed out", () => {
      const meds = [
        { id: "b", drug_name: "B", schedule_times: ["07:30"], schedule_spec: { ...base, kind: "weekdays", times: ["07:30"], days: [2, 5] } },
        { id: "c", drug_name: "C", schedule_times: [], schedule_spec: { ...base, kind: "as_needed", maxPerDay: 2 } },
      ];
      expect(buildTodaysDoseChecklist(meds, [], monday)).toEqual([]);
      expect(buildTodaysDoseChecklist(meds, [], monday + 86_400_000).map((i) => i.medicationId)).toEqual(["b"]);
    });

    it("falls back to the plain list of times when the structured schedule is unreadable", () => {
      const med = { id: "d", drug_name: "D", schedule_times: ["08:00"], schedule_spec: { kind: "nonsense" } };
      expect(buildTodaysDoseChecklist([med], [], monday).map((i) => i.time)).toEqual(["08:00"]);
    });
  });
});
