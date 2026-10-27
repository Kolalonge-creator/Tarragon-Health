import { describe, expect, it } from "@jest/globals";
import {
  CARE_GAP_TYPES,
  MANUAL_CLOSURE_REASONS,
  closureReasonLabel,
  gapTypeLabel,
  isDoctorGap,
  nextAttempt,
  nextAttemptText,
  rankCareGaps,
  shiftDate,
  whyOpenLines,
} from "./gap-model";

type Why = Parameters<typeof whyOpenLines>[0];
const gap = (why: Record<string, unknown>, extra: Partial<Why> = {}): Why => ({ gap_type: "missed_reading", due_date: "2026-10-21", why: why as Why["why"], ...extra });

describe("care gap ranking", () => {
  const base = { due_date: "2026-10-01", trend_flag: false };
  it("ranks risk first, then days overdue, then a rising trend", () => {
    const rows = [
      { id: "a", risk_rank: 1, days_overdue: 30, ...base },
      { id: "b", risk_rank: 3, days_overdue: 2, ...base },
      { id: "c", risk_rank: 3, days_overdue: 9, ...base },
      { id: "d", risk_rank: 3, days_overdue: 9, ...base, trend_flag: true },
      { id: "e", risk_rank: 4, days_overdue: 0, ...base },
    ];
    expect(rankCareGaps(rows).map((r) => r.id)).toEqual(["e", "d", "c", "b", "a"]);
  });

  it("breaks a full tie by due date then id, and does not change its input", () => {
    const rows = [
      { id: "z", risk_rank: 2, days_overdue: 5, trend_flag: false, due_date: "2026-10-03" },
      { id: "y", risk_rank: 2, days_overdue: 5, trend_flag: false, due_date: "2026-10-01" },
      { id: "x", risk_rank: 2, days_overdue: 5, trend_flag: false, due_date: "2026-10-01" },
    ];
    const copy = rows.map((r) => r.id);
    expect(rankCareGaps(rows).map((r) => r.id)).toEqual(["x", "y", "z"]);
    expect(rows.map((r) => r.id)).toEqual(copy);
  });
});

describe("why this gap is open (staff text)", () => {
  it("states the failed criterion, the line and the last signal", () => {
    const lines = whyOpenLines(gap({ criterion: "no_reading_in_days", signal: "blood_pressure", threshold_days: 14, days_since: 21, last_signal_at: "2026-09-18T08:00:00+00:00", anchor: "last_reading" }));
    expect(lines).toEqual(["No blood pressure reading in 21 days (the line is 14).", "Last recorded 18 Sep"]);
  });

  it("counts a plan with no reading from the plan start, not from the due date", () => {
    // due = plan start (2026-10-07) + 14 days
    const lines = whyOpenLines(gap({ criterion: "no_reading_in_days", signal: "blood_pressure", threshold_days: 14, days_since: 20, last_signal_at: null, anchor: "plan_start" }, { due_date: "2026-10-21" }));
    expect(lines[1]).toBe("None recorded yet, counted from the start of the plan on 7 Oct");
  });

  it("names glucose for a glucose gap", () => {
    expect(whyOpenLines(gap({ criterion: "no_reading_in_days", signal: "glucose", threshold_days: 10, days_since: 12, anchor: "last_reading", last_signal_at: "2026-10-01T08:00:00Z" }))[0]).toMatch(/glucose/);
  });

  it("explains a lab, a refill, a trend and an adherence gap without any value", () => {
    expect(whyOpenLines(gap({ criterion: "no_lab_in_days", lookback_days: 365, grace_days: 30, last_signal_at: "2025-09-01T08:00:00Z", anchor: "last_lab" }, { gap_type: "no_hba1c_12_months" }))[0]).toBe(
      "No matching lab result in the last 365 days, and 30 days have passed since it fell due.",
    );
    expect(whyOpenLines(gap({ criterion: "refill_past_due_days", threshold_days: 7, days_since: 10 }, { gap_type: "medication_refill_lapse" }))).toEqual(["The refill was due 10 days ago (the line is 7)."]);
    const trend = whyOpenLines(gap({ criterion: "bp_average_rose_between_windows", window_days: 14, min_rise_systolic_mmhg: 5, readings_in_window: 3, readings_in_prior_window: 3 }, { gap_type: "rising_bp_trend" }));
    expect(trend).toHaveLength(1);
    expect(trend[0]).toMatch(/last 14 days/);
    expect(trend[0]).not.toMatch(/\d{3}/);
    expect(whyOpenLines(gap({ criterion: "adherence_below_line_signal", last_signal_at: "2026-10-23T07:00:00Z" }, { gap_type: "adherence_lapse" }))).toEqual(["The adherence check flagged this patient. Signal seen 23 Oct."]);
  });

  it("falls back to a plain line for an unknown or malformed why, never a guess", () => {
    const plain = "The rule that opened this gap gave no detail.";
    expect(whyOpenLines(gap({}))).toEqual([plain]);
    expect(whyOpenLines(gap({ criterion: "something_new" }))).toEqual([plain]);
    expect(whyOpenLines(gap({ criterion: "no_reading_in_days", days_since: "many" }))).toEqual([plain]);
    expect(whyOpenLines({ gap_type: "missed_reading", due_date: "2026-10-21", why: null as unknown as Why["why"] })).toEqual([plain]);
  });
});

describe("next attempt, labels and routing", () => {
  const now = new Date("2026-10-27T10:00:00Z");
  it("is none, scheduled or overdue", () => {
    expect(nextAttempt({ status: "open", next_attempt_due_at: null }, now)).toEqual({ kind: "none" });
    expect(nextAttempt({ status: "closed", next_attempt_due_at: "2026-10-30T10:00:00Z" }, now)).toEqual({ kind: "none" });
    expect(nextAttempt({ status: "open", next_attempt_due_at: "2026-10-30T10:00:00Z" }, now).kind).toBe("scheduled");
    expect(nextAttempt({ status: "open", next_attempt_due_at: "2026-10-26T10:00:00Z" }, now).kind).toBe("overdue");
    expect(nextAttemptText(nextAttempt({ status: "open", next_attempt_due_at: "2026-10-26T10:00:00Z" }, now))).toBe("Next attempt overdue since 26 Oct");
  });

  it("has a label for every gap type and a reason a person may choose never includes closed", () => {
    for (const t of CARE_GAP_TYPES) expect(gapTypeLabel(t)).not.toBe(t);
    expect([...MANUAL_CLOSURE_REASONS]).toEqual(["declined", "unreachable", "wrong"]);
    expect(closureReasonLabel("closed")).toBe("Closed by a recorded outcome");
    expect(closureReasonLabel(null)).toBe("");
  });

  it("routes a judgement item to a doctor and logistics to a coordinator", () => {
    expect(isDoctorGap({ owner_role: "clinician" })).toBe(true);
    expect(isDoctorGap({ owner_role: "care_coordinator" })).toBe(false);
  });

  it("shifts a date by whole days across month and year ends", () => {
    expect(shiftDate("2026-10-21", -14)).toBe("2026-10-07");
    expect(shiftDate("2026-01-05", -10)).toBe("2025-12-26");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
  });
});
