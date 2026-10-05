import { describe, expect, it } from "@jest/globals";
import { diffNotifications, planDoseNotifications, reminderIssues, type ReminderHealthInput, type ReminderMedicine } from "./reminders";
import type { ScheduleSpec } from "./types";

const base = { startDate: null, endDate: null, foodNote: null } as const;
const daily = (times: string[]): ScheduleSpec => ({ ...base, kind: "daily", times });
const now = Date.parse("2026-10-05T05:00:00Z"); // 06:00 Lagos
const cfg = { maxPending: 60, horizonDays: 14, followUpMinWindowMinutes: 30 };
const meds: ReminderMedicine[] = [
  { id: "a", active: true, spec: daily(["08:00", "20:00"]) },
  { id: "b", active: true, spec: daily(["08:00"]) },
  { id: "c", active: false, spec: daily(["09:00"]) },
];

describe("planDoseNotifications", () => {
  it("shares one notification between doses due at the same minute and skips inactive medicines", () => {
    const plan = planDoseNotifications(meds, new Set(), now, { maxPending: 4, horizonDays: 14, followUpMinWindowMinutes: 30 });
    expect(plan).toHaveLength(4);
    expect(plan[0].slotKeys).toEqual(["a|2026-10-05|08:00", "b|2026-10-05|08:00"]);
    expect(plan[1].slotKeys).toEqual(["a|2026-10-05|20:00"]);
    expect(plan.every((p) => !p.slotKeys.some((k) => k.startsWith("c|")))).toBe(true);
  });
  it("never plans more than the cap (the iOS limit is 64) and goes earliest first", () => {
    const heavy: ReminderMedicine[] = [{ id: "x", active: true, spec: daily(["06:30", "08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00"]) }];
    const plan = planDoseNotifications(heavy, new Set(), now, { maxPending: 60, horizonDays: 14, followUpMinWindowMinutes: 30 });
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
    const plan = planDoseNotifications(meds, new Set(), now, { maxPending: 1000, horizonDays: 2, followUpMinWindowMinutes: 30 });
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

describe("flexible windows", () => {
  const windowed = (windowMinutes: number): ReminderMedicine[] => [
    { id: "w", active: true, spec: { ...base, kind: "daily", times: ["08:00"], windowMinutes } },
  ];
  it("adds one follow-up at the middle of a long enough window, and marks it as one", () => {
    const plan = planDoseNotifications(windowed(120), new Set(), now, { ...cfg, horizonDays: 1 });
    // 06:00 Lagos now; today's 08:00 start, 09:00 middle
    expect(plan.slice(0, 2).map((p) => [p.kind, p.fireAtMs])).toEqual([
      ["due", Date.parse("2026-10-05T07:00:00Z")],
      ["follow_up", Date.parse("2026-10-05T08:00:00Z")],
    ]);
  });
  it("gives no follow-up to an exact time or a short window", () => {
    expect(planDoseNotifications(windowed(0), new Set(), now, cfg).every((p) => p.kind === "due")).toBe(true);
    expect(planDoseNotifications(windowed(20), new Set(), now, cfg).every((p) => p.kind === "due")).toBe(true);
  });
  it("sends only the follow-up when the start has already passed, and nothing once the dose is answered", () => {
    const later = Date.parse("2026-10-05T07:30:00Z"); // 08:30, start passed, middle 09:00 ahead
    const plan = planDoseNotifications(windowed(120), new Set(), later, { ...cfg, horizonDays: 1 });
    expect(plan[0]).toMatchObject({ kind: "follow_up", fireAtMs: Date.parse("2026-10-05T08:00:00Z") });
    const answered = planDoseNotifications(windowed(120), new Set(["w|2026-10-05|08:00"]), later, { ...cfg, horizonDays: 1 });
    expect(answered.every((p) => !p.slotKeys.includes("w|2026-10-05|08:00"))).toBe(true);
  });
  it("lets a dose that is due outrank a follow-up that lands on the same minute", () => {
    const meds: ReminderMedicine[] = [
      ...windowed(120),
      { id: "x", active: true, spec: { ...base, kind: "daily", times: ["09:00"] } },
    ];
    const plan = planDoseNotifications(meds, new Set(), now, { ...cfg, horizonDays: 1 });
    const at9 = plan.find((p) => p.fireAtMs === Date.parse("2026-10-05T08:00:00Z"));
    expect(at9).toMatchObject({ kind: "due", slotKeys: ["w|2026-10-05|08:00", "x|2026-10-05|09:00"] });
    // and the other way round: the due dose is already there when the follow-up arrives
    const reversed = planDoseNotifications([meds[1], meds[0]], new Set(), now, { ...cfg, horizonDays: 1 });
    expect(reversed.find((p) => p.fireAtMs === Date.parse("2026-10-05T08:00:00Z"))?.kind).toBe("due");
  });
});

describe("diffNotifications", () => {
  const plan = planDoseNotifications(meds, new Set(), now, { maxPending: 3, horizonDays: 14, followUpMinWindowMinutes: 30 });
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
