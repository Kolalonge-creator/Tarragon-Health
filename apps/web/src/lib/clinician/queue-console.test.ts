import { classCounts, completeTaskSchema, leadPatientsSchema, minutesLeft, patientSummarySchema, queueSummarySchema, safetyConcernSchema } from "./queue-console";

describe("minutesLeft", () => {
  const now = new Date("2026-10-06T10:00:00Z");
  it("rounds up and never goes negative", () => {
    expect(minutesLeft("2026-10-06T10:00:30Z", now)).toBe(1);
    expect(minutesLeft("2026-10-06T09:00:00Z", now)).toBe(0);
  });
  it("is null with no expiry or a bad date", () => {
    expect(minutesLeft(null, now)).toBeNull();
    expect(minutesLeft("nonsense", now)).toBeNull();
  });
});

describe("classCounts", () => {
  it("orders classes numerically and totals them", () => {
    expect(classCounts({ "3": 2, "1": 1, "10": 4 })).toEqual({
      rows: [{ key: "1", count: 1 }, { key: "3", count: 2 }, { key: "10", count: 4 }],
      total: 7,
    });
  });
  it("is empty for no classes", () => {
    expect(classCounts({})).toEqual({ rows: [], total: 0 });
  });
});

describe("schemas", () => {
  it("accepts the queue_summary shape, with and without a fee", () => {
    expect(queueSummarySchema.safeParse({ open: true, blocked: null, next_fee_kobo: 150000, by_class: { "1": 2 } }).success).toBe(true);
    expect(queueSummarySchema.safeParse({ open: false, by_class: {} }).success).toBe(true);
  });
  it("rejects a queue_summary with no counts", () => {
    expect(queueSummarySchema.safeParse({ open: true }).success).toBe(false);
  });
  it("a denied summary carries no sections", () => {
    const parsed = patientSummarySchema.safeParse({ status: "denied" });
    expect(parsed.success && parsed.data.readings).toBeUndefined();
  });
  it("a partial summary can omit sections", () => {
    expect(patientSummarySchema.safeParse({ status: "partial", denied: ["results"], care_circle: { active_members: 0 } }).success).toBe(true);
  });
  it("a lead row with no reading or adherence still parses", () => {
    const ok = leadPatientsSchema.safeParse([{ patient_id: "7b8d6c1e-3f1a-4b0e-9d5a-1f2e3d4c5b6a", first_name: null, last_bp: null, adherence_percent: null, pending_proposals: 0, due_tasks: 0 }]);
    expect(ok.success).toBe(true);
  });
  it("completing a task needs a real note", () => {
    const id = "7b8d6c1e-3f1a-4b0e-9d5a-1f2e3d4c5b6a";
    expect(completeTaskSchema.safeParse({ taskId: id, note: "short" }).success).toBe(false);
    expect(completeTaskSchema.safeParse({ taskId: id, note: "Reviewed readings and called the patient." }).success).toBe(true);
  });
  it("a safety concern needs 20 characters and a known category", () => {
    expect(safetyConcernSchema.safeParse({ category: "patient_safety", severity: "high", description: "too short" }).success).toBe(false);
    expect(safetyConcernSchema.safeParse({ category: "nope", severity: "high", description: "x".repeat(25) }).success).toBe(false);
    expect(safetyConcernSchema.safeParse({ category: "patient_safety", severity: "high", description: "x".repeat(25) }).success).toBe(true);
  });
});
