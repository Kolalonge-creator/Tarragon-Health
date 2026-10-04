import { describe, expect, it } from "@jest/globals";
import { diffNotifications, planDoseNotifications, reminderIssues, type ReminderHealthInput, type ReminderMedicine } from "./reminders";
import type { ScheduleSpec } from "./types";

const base = { startDate: null, endDate: null, foodNote: null } as const;
const daily = (times: string[]): ScheduleSpec => ({ ...base, kind: "daily", times });
const now = Date.parse("2026-10-05T05:00:00Z"); // 06:00 Lagos
const cfg = { maxPending: 60, horizonDays: 14 };
const meds: ReminderMedicine[] = [
  { id: "a", active: true, spec: daily(["08:00", "20:00"]) },
  { id: "b", active: true, spec: daily(["08:00"]) },
  { id: "c", active: false, spec: daily(["09:00"]) },
];

describe("planDoseNotifications", () => {
  it("shares one notification between doses due at the same minute and skips inactive medicines", () => {
    const plan = planDoseNotifications(meds, new Set(), now, { maxPending: 4, horizonDays: 14 });
    expect(plan).toHaveLength(4);
    expect(plan[0].slotKeys).toEqual(["a|2026-10-05|08:00", "b|2026-10-05|08:00"]);
    expect(plan[1].slotKeys).toEqual(["a|2026-10-05|20:00"]);
    expect(plan.every((p) => !p.slotKeys.some((k) => k.startsWith("c|")))).toBe(true);
  });
  it("never plans more than the cap (the iOS limit is 64) and goes earliest first", () => {
    const heavy: ReminderMedicine[] = [{ id: "x", active: true, spec: daily(["06:30", "08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00"]) }];
    const plan = planDoseNotifications(heavy, new Set(), now, { maxPending: 60, horizonDays: 14 });
    expect(plan).toHaveLength(60);
    expect(plan.map((p) => p.fireAtMs)).toEqual([...plan.map((p) => p.fireAtMs)].sort((a, b) => a - b));
  });
  it("leaves out answered slots and past times", () => {
    const closed = new Set(["a|2026-10-05|08:00", "b|2026-10-05|08:00"]);
    const plan = planDoseNotifications(meds, closed, now, cfg);
    expect(plan[0].slotKeys).toEqual(["a|2026-10-05|20:00"]);
    const later = planDoseNotifications(meds, new Set(), Date.parse("2026-10-05T10:00:00Z"), cfg);
    expect(later[0].slotKeys).toEqual(["a|2026-10-05|20:00"]);
  });
  it("stays inside the horizon", () => {
    const plan = planDoseNotifications(meds, new Set(), now, { maxPending: 1000, horizonDays: 2 });
    expect(plan.every((p) => p.fireAtMs <= now + 2 * 86400000)).toBe(true);
    expect(plan.length).toBeLessThanOrEqual(6);
  });
  it("gives the same id for the same minute so planning twice never duplicates", () => {
    const one = planDoseNotifications(meds, new Set(), now, cfg);
    const two = planDoseNotifications(meds, new Set(), now, cfg);
    expect(one.map((p) => p.id)).toEqual(two.map((p) => p.id));
  });
  it("plans nothing for an as-needed medicine", () => {
    const prn: ReminderMedicine[] = [{ id: "p", active: true, spec: { ...base, kind: "as_needed", maxPerDay: 2 } }];
    expect(planDoseNotifications(prn, new Set(), now, cfg)).toEqual([]);
  });
});

describe("diffNotifications", () => {
  const plan = planDoseNotifications(meds, new Set(), now, { maxPending: 3, horizonDays: 14 });
  it("schedules what is missing and cancels what is no longer wanted, touching only dose ids", () => {
    const d = diffNotifications(plan, [plan[0].id, "dose|1", "something-else"]);
    expect(d.toSchedule.map((p) => p.id)).toEqual([plan[1].id, plan[2].id]);
    expect(d.toCancel).toEqual(["dose|1"]);
  });
  it("does nothing when the phone already matches", () => {
    const d = diffNotifications(plan, plan.map((p) => p.id));
    expect(d).toEqual({ toSchedule: [], toCancel: [] });
  });
});

describe("reminderIssues", () => {
  const ok: ReminderHealthInput = {
    notificationsAllowed: true,
    exactAlarmsAllowed: true,
    plannedCount: 5,
    pendingCount: 5,
    lastPlannedAtMs: now - 1000,
    nowMs: now,
    manufacturer: "google",
    stalePlanHours: 24,
  };
  it("is empty when nothing is known to be wrong", () => expect(reminderIssues(ok)).toEqual([]));
  it("flags notifications switched off, and does not also say nothing is scheduled", () => {
    expect(reminderIssues({ ...ok, notificationsAllowed: false, pendingCount: 0 })).toEqual(["notifications_off"]);
  });
  it("flags exact alarms off only when that is false (null means not applicable)", () => {
    expect(reminderIssues({ ...ok, exactAlarmsAllowed: false })).toEqual(["exact_alarms_off"]);
    expect(reminderIssues({ ...ok, exactAlarmsAllowed: null })).toEqual([]);
  });
  it("flags a plan that never reached the phone", () => {
    expect(reminderIssues({ ...ok, pendingCount: 0 })).toEqual(["nothing_scheduled"]);
    expect(reminderIssues({ ...ok, plannedCount: 0, pendingCount: 0 })).toEqual([]);
  });
  it("flags a plan that was never built or is stale, but not when there is nothing to plan", () => {
    expect(reminderIssues({ ...ok, lastPlannedAtMs: null })).toEqual(["plan_out_of_date"]);
    expect(reminderIssues({ ...ok, lastPlannedAtMs: now - 25 * 3600_000 })).toEqual(["plan_out_of_date"]);
    expect(reminderIssues({ ...ok, lastPlannedAtMs: null, plannedCount: 0, pendingCount: 0 })).toEqual([]);
  });
  it("flags a maker known to stop background apps only when reminders look stopped", () => {
    expect(reminderIssues({ ...ok, manufacturer: "TECNO" })).toEqual([]);
    expect(reminderIssues({ ...ok, manufacturer: "TECNO", pendingCount: 0 })).toEqual(["nothing_scheduled", "maker_may_stop_reminders"]);
    expect(reminderIssues({ ...ok, manufacturer: "Infinix mobility", lastPlannedAtMs: null })).toEqual(["plan_out_of_date", "maker_may_stop_reminders"]);
    expect(reminderIssues({ ...ok, manufacturer: "google", pendingCount: 0 })).toEqual(["nothing_scheduled"]);
    expect(reminderIssues({ ...ok, manufacturer: null, pendingCount: 0 })).toEqual(["nothing_scheduled"]);
  });
});
