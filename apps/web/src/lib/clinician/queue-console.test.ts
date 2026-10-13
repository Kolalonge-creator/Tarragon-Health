import { slaState, rankLeadPatients, classCounts, completeTaskSchema, leadPatientsSchema, minutesLeft, patientSummarySchema, queueSummarySchema, safetyConcernSchema } from "./queue-console";

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

describe("rankLeadPatients", () => {
  const lead = (name: string, due: number, prop: number, adh: number | null) => ({
    patient_id: name, first_name: name, last_bp: null, adherence_percent: adh, pending_proposals: prop, due_tasks: due,
  });
  it("puts tasks due first, then proposals, then poor adherence, then name", () => {
    const out = rankLeadPatients([lead("D", 0, 0, 90), lead("C", 0, 1, 90), lead("B", 1, 0, 90), lead("A", 0, 0, 40), lead("E", 0, 0, null)]);
    expect(out.map((l) => l.first_name)).toEqual(["B", "C", "A", "D", "E"]);
  });
  it("does not change the input", () => {
    const input = [lead("B", 0, 0, 90), lead("A", 1, 0, 90)];
    rankLeadPatients(input);
    expect(input[0].first_name).toBe("B");
  });
});

describe("slaState", () => {
  const now = new Date("2026-10-06T10:00:00Z");
  it("is overdue at and after the due time", () => {
    expect(slaState("2026-10-06T10:00:00Z", now)).toEqual({ kind: "overdue" });
    expect(slaState("2026-10-06T09:00:00Z", now)).toEqual({ kind: "overdue" });
  });
  it("rounds minutes left up", () => {
    expect(slaState("2026-10-06T10:00:30Z", now)).toEqual({ kind: "due", minutes: 1, warn: false });
  });
  it("warns only inside the window it is given", () => {
    expect(slaState("2026-10-06T10:20:00Z", now, 30)).toEqual({ kind: "due", minutes: 20, warn: true });
    expect(slaState("2026-10-06T11:00:00Z", now, 30)).toEqual({ kind: "due", minutes: 60, warn: false });
    expect(slaState("2026-10-06T10:30:00Z", now, 30)).toMatchObject({ warn: true });
  });
  it("is none without a due time or with a bad one", () => {
    expect(slaState(null, now)).toEqual({ kind: "none" });
    expect(slaState("nonsense", now)).toEqual({ kind: "none" });
  });
});
