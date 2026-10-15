import { attemptsFromRows, blockedReasonKey, completionOptions, escalatedTaskSchema, lagosLocalToIso, SYSTEM_CLOSED_TASK_TYPES, slaState, rankLeadPatients, classCounts, completeTaskSchema, leadPatientsSchema, minutesLeft, patientSummarySchema, queueSummarySchema, safetyConcernSchema } from "./queue-console";

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
  it("completing a task needs a code; the note is optional and bounded", () => {
    const id = "7b8d6c1e-3f1a-4b0e-9d5a-1f2e3d4c5b6a";
    expect(completeTaskSchema.safeParse({ taskId: id, code: "" }).success).toBe(false);
    expect(completeTaskSchema.safeParse({ taskId: id, code: "referred_on" }).success).toBe(true);
    expect(completeTaskSchema.safeParse({ taskId: id, code: "referred_on", note: "x".repeat(1001) }).success).toBe(false);
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

describe("S16-S20 queue screen helpers", () => {
  it("the new summary keys are optional, so an older answer still parses", () => {
    expect(queueSummarySchema.safeParse({ open: true, by_class: {} }).success).toBe(true);
    const full = queueSummarySchema.safeParse({
      open: false, blocked: "queue_cooling_off", by_class: {}, cooling_off_until: "2026-10-14T12:00:00Z", escalated_claimable: 2, reliability_score: 83.5,
      offered: [{ task_id: "7b8d6c1e-3f1a-4b0e-9d5a-1f2e3d4c5b6a", type: "amber_bp_review", priority_class: 4, due_at: null, window_ends_at: "2026-10-14T12:00:00Z" }],
    });
    expect(full.success).toBe(true);
  });

  it("an escalated overview row carries ids and ages, nothing about a patient", () => {
    const row = { task_id: "7b8d6c1e-3f1a-4b0e-9d5a-1f2e3d4c5b6a", type: "symptom_review", priority_class: 5, due_at: null, escalated_at: null, age_minutes: 90, escalation_level: 1, handback_count: 0 };
    expect(escalatedTaskSchema.safeParse(row).success).toBe(true);
    expect(Object.keys(escalatedTaskSchema.shape)).not.toContain("patient_id");
  });

  it("blockedReasonKey names a known reason and falls back for an unknown one", () => {
    expect(blockedReasonKey(null)).toBeNull();
    expect(blockedReasonKey("queue_cooling_off")).toBe("queue.blocked.queue_cooling_off");
    expect(blockedReasonKey("something_new")).toBe("queue.blocked.other");
  });

  it("completion options come from the configuration, per type", () => {
    expect(completionOptions("titration_signoff").codes).toEqual(["signed", "amended", "rejected"]);
    expect(completionOptions("amber_bp_review").attemptsCode).toBeNull();
    const crit = completionOptions("critical_result_review");
    expect(crit.attemptsCode).toBe("contact_attempts_documented");
    expect(crit.minAttempts).toBeGreaterThan(0);
    expect(crit.methods.length).toBeGreaterThan(0);
  });

  it("types that finish by the work itself on another screen point to it", () => {
    expect(SYSTEM_CLOSED_TASK_TYPES["titration_signoff"]?.href("p1")).toBe("/clinician/patients/p1/care-plan-changes");
    expect(SYSTEM_CLOSED_TASK_TYPES["red_event_unacknowledged"]?.href("p1")).toBe("/clinician/on-call");
    expect(SYSTEM_CLOSED_TASK_TYPES["symptom_review"]?.href("p1")).toBe("/clinician/consultations");
  });

  it("Lagos time becomes a precise time; nonsense is refused", () => {
    expect(lagosLocalToIso("2026-10-14T13:05")).toBe("2026-10-14T12:05:00.000Z");
    expect(lagosLocalToIso("")).toBeNull();
    expect(lagosLocalToIso("2026-13-45T99:99")).toBeNull();
  });

  it("attempt rows: blank rows are skipped and unreadable times are dropped", () => {
    expect(attemptsFromRows([
      { method: "phone_call", reached: true, at: "2026-10-14T13:05" },
      { method: "", reached: false, at: "" },
      { method: "video_call", reached: false, at: "never" },
    ])).toEqual([{ at: "2026-10-14T12:05:00.000Z", method: "phone_call", reached: true }]);
  });
});
