import { describe, expect, it } from "@jest/globals";
import { diffNotifications, keepRemindersGroup, planDoseNotifications, reminderIssues, type ReminderHealthInput, type ReminderMedicine } from "./reminders";
import type { ScheduleSpec } from "./types";
import { parseScheduleSpec } from "./schedule";
import { TEST_ANCHOR_DEFAULTS, TEST_SLOT_OF, TEST_SLOTS } from "./anchors.fixtures";

const base = { startDate: null, endDate: null, foodNote: null } as const;
const daily = (times: string[]): ScheduleSpec => ({ ...base, kind: "daily", times });
const now = Date.parse("2026-10-05T05:00:00Z"); // 06:00 Lagos
const cfg = { maxPending: 60, horizonDays: 14, followUpMinWindowMinutes: 30, maxFollowUps: 8 };
const meds: ReminderMedicine[] = [
  { id: "a", active: true, spec: daily(["08:00", "20:00"]) },
  { id: "b", active: true, spec: daily(["08:00"]) },
  { id: "c", active: false, spec: daily(["09:00"]) },
];

describe("planDoseNotifications", () => {
  it("shares one notification between doses due at the same minute and skips inactive medicines", () => {
    const plan = planDoseNotifications(meds, new Set(), now, { maxPending: 4, horizonDays: 14, followUpMinWindowMinutes: 30, maxFollowUps: 8 });
    expect(plan).toHaveLength(4);
    expect(plan[0].slotKeys).toEqual(["a|2026-10-05|08:00", "b|2026-10-05|08:00"]);
    expect(plan[1].slotKeys).toEqual(["a|2026-10-05|20:00"]);
    expect(plan.every((p) => !p.slotKeys.some((k) => k.startsWith("c|")))).toBe(true);
  });
  it("never plans more than the cap (the iOS limit is 64) and goes earliest first", () => {
    const heavy: ReminderMedicine[] = [{ id: "x", active: true, spec: daily(["06:30", "08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00"]) }];
    const plan = planDoseNotifications(heavy, new Set(), now, { maxPending: 60, horizonDays: 14, followUpMinWindowMinutes: 30, maxFollowUps: 8 });
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
    const plan = planDoseNotifications(meds, new Set(), now, { maxPending: 1000, horizonDays: 2, followUpMinWindowMinutes: 30, maxFollowUps: 8 });
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
  it("keeps follow-ups from using the places meant for due reminders (S08g)", () => {
    const small = { maxPending: 10, horizonDays: 14, followUpMinWindowMinutes: 30 };
    // Every day has a due reminder at 08:00 and a follow-up at 09:00: without a budget, 10 places hold 5 days of due ones.
    const noBudget = planDoseNotifications(windowed(120), new Set(), now, { ...small, maxFollowUps: 100 });
    expect(noBudget.filter((p) => p.kind === "due")).toHaveLength(5);
    const capped = planDoseNotifications(windowed(120), new Set(), now, { ...small, maxFollowUps: 2 });
    expect(capped).toHaveLength(10);
    expect(capped.filter((p) => p.kind === "follow_up")).toHaveLength(2);
    expect(capped.filter((p) => p.kind === "due")).toHaveLength(8);
    // the follow-ups kept are the earliest ones, and the due reminders still run on in order
    const fireTimes = capped.map((p) => p.fireAtMs);
    expect([...fireTimes].sort((a, b) => a - b)).toEqual(fireTimes);
    expect(capped.filter((p) => p.kind === "follow_up").map((p) => p.fireAtMs)).toEqual(
      noBudget.filter((p) => p.kind === "follow_up").slice(0, 2).map((p) => p.fireAtMs),
    );
  });
  it("holds no follow-ups at all when the budget is zero, and never exceeds the cap", () => {
    const plan = planDoseNotifications(windowed(120), new Set(), now, { maxPending: 6, horizonDays: 14, followUpMinWindowMinutes: 30, maxFollowUps: 0 });
    expect(plan).toHaveLength(6);
    expect(plan.every((p) => p.kind === "due")).toBe(true);
  });
  it("gives a follow-up its own id, so a minute that turns into a due dose is rescheduled", () => {
    const followOnly = planDoseNotifications(windowed(120), new Set(), now, { ...cfg, horizonDays: 1 }).find((p) => p.kind === "follow_up")!;
    expect(followOnly.id.endsWith("|f")).toBe(true);
    const meds: ReminderMedicine[] = [...windowed(120), { id: "z", active: true, spec: { ...base, kind: "daily", times: ["09:00"] } }];
    const merged = planDoseNotifications(meds, new Set(), now, { ...cfg, horizonDays: 1 }).find((p) => p.fireAtMs === followOnly.fireAtMs)!;
    expect(merged.kind).toBe("due");
    expect(merged.id.endsWith("|f")).toBe(false);
    // the phone holds the follow-up id; the new plan asks for the due id: the follow-up is cancelled, the due one scheduled
    const diff = diffNotifications([merged], [followOnly.id]);
    expect(diff.toCancel).toEqual([followOnly.id]);
    expect(diff.toSchedule).toEqual([merged]);
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
  const plan = planDoseNotifications(meds, new Set(), now, { maxPending: 3, horizonDays: 14, followUpMinWindowMinutes: 30, maxFollowUps: 8 });
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

describe("keepRemindersGroup", () => {
  it("picks the checklist for the phone maker, in any letter case, and the generic one when it is unknown", () => {
    expect(keepRemindersGroup("TECNO")).toBe("transsion");
    expect(keepRemindersGroup("Infinix")).toBe("transsion");
    expect(keepRemindersGroup("itel")).toBe("transsion");
    expect(keepRemindersGroup("samsung")).toBe("samsung");
    expect(keepRemindersGroup("Xiaomi")).toBe("other_aggressive");
    expect(keepRemindersGroup("Google")).toBe("generic");
    expect(keepRemindersGroup(null)).toBe("generic");
  });
});

describe("anchored doses in the reminder plan (S08z)", () => {
  const profile = { slots: TEST_SLOTS, defaults: TEST_ANCHOR_DEFAULTS, times: {}, shifts: [] };
  const spec = (anchored: unknown[], times: string[] = []): ScheduleSpec => {
    const r = parseScheduleSpec({ kind: "daily", times, anchored }, profile);
    if (!r.ok) throw new Error("fixture");
    return r.spec;
  };
  const cfg = { maxPending: 20, horizonDays: 2, followUpMinWindowMinutes: 30, maxFollowUps: 3 };
  const now = Date.parse("2026-10-05T00:00:00Z");

  it("plans an anchored dose at its resolved time and says which anchor it is", () => {
    const plan = planDoseNotifications([{ id: "m1", active: true, spec: spec([{ slot: TEST_SLOT_OF.breakfast, offsetMinutes: 30 }]) }], new Set(), now, cfg);
    expect(plan[0]?.anchor).toEqual({ anchor: "breakfast", offsetMinutes: 30 });
    // Breakfast 07:30 plus 30 minutes is 08:00 Lagos, which is 07:00 UTC.
    expect(new Date(plan[0]!.fireAtMs).toISOString()).toBe("2026-10-05T07:00:00.000Z");
  });

  it("names the anchor only when every dose in the notification shares it", () => {
    const same = planDoseNotifications(
      [
        { id: "m1", active: true, spec: spec([{ slot: TEST_SLOT_OF.breakfast, offsetMinutes: 0 }]) },
        { id: "m2", active: true, spec: spec([{ slot: TEST_SLOT_OF.breakfast, offsetMinutes: 0 }]) },
      ],
      new Set(),
      now,
      cfg
    );
    expect(same[0]?.slotKeys).toHaveLength(2);
    expect(same[0]?.anchor).toEqual({ anchor: "breakfast", offsetMinutes: 0 });
    const mixed = planDoseNotifications(
      [
        { id: "m1", active: true, spec: spec([{ slot: TEST_SLOT_OF.breakfast, offsetMinutes: 0 }]) },
        { id: "m2", active: true, spec: spec([], ["07:30"]) },
      ],
      new Set(),
      now,
      cfg
    );
    expect(mixed[0]?.slotKeys).toHaveLength(2);
    expect("anchor" in (mixed[0] ?? {})).toBe(false);
    const differentOffset = planDoseNotifications(
      [
        { id: "m1", active: true, spec: spec([{ slot: TEST_SLOT_OF.waking, offsetMinutes: 60 }]) },
        { id: "m2", active: true, spec: spec([{ slot: TEST_SLOT_OF.breakfast, offsetMinutes: 0 }]) },
      ],
      new Set(),
      now,
      cfg
    );
    expect(differentOffset[0]?.slotKeys).toHaveLength(2);
    expect("anchor" in (differentOffset[0] ?? {})).toBe(false);
  });

  it("a day shift moves the planned time with no change to the schedule", () => {
    const shifted = parseScheduleSpec(
      { kind: "daily", anchored: [{ slot: TEST_SLOT_OF.dinner, offsetMinutes: 0 }] },
      { slots: TEST_SLOTS, defaults: TEST_ANCHOR_DEFAULTS, times: {}, shifts: [{ startsOn: "2026-10-05", endsOn: "2026-10-05", offsets: { dinner: 90 } }] }
    );
    if (!shifted.ok) throw new Error("fixture");
    const plan = planDoseNotifications([{ id: "m1", active: true, spec: shifted.spec }], new Set(), now, cfg);
    // Dinner 19:30 plus 90 minutes is 21:00 on the 5th and 19:30 on the 6th (Lagos).
    expect(plan.map((n) => new Date(n.fireAtMs).toISOString())).toEqual(["2026-10-05T20:00:00.000Z", "2026-10-06T18:30:00.000Z"]);
  });
});
