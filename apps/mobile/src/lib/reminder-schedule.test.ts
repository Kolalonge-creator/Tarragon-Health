import {
  applyQuietHours,
  applyReminderAction,
  deriveReminderStatus,
  expandOccurrences,
  isOverdue,
  planRollingWindow,
  type ReminderInstance,
  type ReminderSchedule,
} from "./reminder-schedule";
import { lagosTimeToUtcMs } from "./lagos-date";
import type { ReminderBehaviourConfig } from "./s07-config";

// Pinned on purpose: see bp-average.test.ts.
const cfg: ReminderBehaviourConfig = { version: 0, snoozeMinutes: 30, maxSnoozes: 3, missedAfterMinutes: 120, maxPending: 60, horizonDays: 14 };
const MIN = 60_000;
const lagos = (date: string, time: string): number => lagosTimeToUtcMs(date, time) as number;
const due = lagos("2026-10-03", "08:00");
const open = (over: Partial<ReminderInstance> = {}): ReminderInstance => ({
  status: "scheduled",
  dueAtMs: due,
  snoozeCount: 0,
  snoozedUntilMs: null,
  actedAtMs: null,
  ...over,
});

describe("applyReminderAction", () => {
  it("closes on take and on skip, stamping the time", () => {
    const taken = applyReminderAction(open(), "take", due + MIN, cfg);
    expect(taken).toMatchObject({ ok: true, instance: { status: "taken", actedAtMs: due + MIN } });
    const skipped = applyReminderAction(open(), "skip", due + MIN, cfg);
    expect(skipped).toMatchObject({ ok: true, instance: { status: "skipped" } });
  });

  it("refuses a second action on a closed reminder", () => {
    const closed = open({ status: "taken", actedAtMs: due });
    expect(applyReminderAction(closed, "skip", due + MIN, cfg)).toEqual({ ok: false, reason: "already_closed" });
  });

  it("snoozes for the configured time and counts it", () => {
    const res = applyReminderAction(open(), "snooze", due, cfg);
    expect(res).toMatchObject({
      ok: true,
      instance: { status: "snoozed", snoozeCount: 1, snoozedUntilMs: due + cfg.snoozeMinutes * MIN },
    });
  });

  it("stops snoozing at the limit so a reminder cannot nag forever", () => {
    expect(applyReminderAction(open({ status: "snoozed", snoozeCount: cfg.maxSnoozes }), "snooze", due, cfg)).toEqual({
      ok: false,
      reason: "snooze_limit",
    });
  });

  it("refuses a snooze once the missed window has passed instead of wasting one", () => {
    expect(applyReminderAction(open(), "snooze", due + cfg.missedAfterMinutes * MIN, cfg)).toEqual({
      ok: false,
      reason: "already_missed",
    });
  });

  it("still lets a missed reminder be marked taken afterwards", () => {
    const res = applyReminderAction(open({ status: "missed" }), "take", due + 600 * MIN, cfg);
    expect(res).toMatchObject({ ok: true, instance: { status: "taken" } });
  });
});

describe("deriveReminderStatus and isOverdue", () => {
  it("is scheduled before due and until the missed window ends", () => {
    expect(deriveReminderStatus(open(), due - MIN, cfg)).toBe("scheduled");
    expect(deriveReminderStatus(open(), due + (cfg.missedAfterMinutes - 1) * MIN, cfg)).toBe("scheduled");
  });

  it("becomes missed from the schedule alone, with no notification involved", () => {
    expect(deriveReminderStatus(open(), due + cfg.missedAfterMinutes * MIN, cfg)).toBe("missed");
  });

  it("stays snoozed until the snooze ends, then is due again", () => {
    const snoozed = open({ status: "snoozed", snoozeCount: 1, snoozedUntilMs: due + 30 * MIN });
    expect(deriveReminderStatus(snoozed, due + 10 * MIN, cfg)).toBe("snoozed");
    expect(deriveReminderStatus(snoozed, due + 31 * MIN, cfg)).toBe("scheduled");
  });

  it("never reopens a closed reminder", () => {
    expect(deriveReminderStatus(open({ status: "taken" }), due + 9999 * MIN, cfg)).toBe("taken");
    expect(deriveReminderStatus(open({ status: "skipped" }), due + 9999 * MIN, cfg)).toBe("skipped");
  });

  it("is overdue only when due and still open", () => {
    expect(isOverdue(open(), due - 1)).toBe(false);
    expect(isOverdue(open(), due)).toBe(true);
    expect(isOverdue(open({ status: "taken" }), due + MIN)).toBe(false);
  });

  it("is not overdue during a snooze the patient asked for, and is again when it ends", () => {
    const snoozed = open({ status: "snoozed", snoozeCount: 1, snoozedUntilMs: due + 30 * MIN });
    expect(isOverdue(snoozed, due + 10 * MIN)).toBe(false);
    expect(isOverdue(snoozed, due + 30 * MIN)).toBe(true);
  });
});

describe("expandOccurrences", () => {
  const daily: ReminderSchedule = { id: "bp", times: ["08:00", "20:00"], days: null, active: true };

  it("expands Lagos wall-clock times into UTC instants over a range", () => {
    const out = expandOccurrences(daily, lagos("2026-10-03", "00:00"), lagos("2026-10-05", "00:00"));
    expect(out).toEqual([
      lagos("2026-10-03", "08:00"),
      lagos("2026-10-03", "20:00"),
      lagos("2026-10-04", "08:00"),
      lagos("2026-10-04", "20:00"),
    ]);
    expect(out[0]).toBe(Date.parse("2026-10-03T07:00:00Z"));
  });

  it("treats the range as half-open", () => {
    const from = lagos("2026-10-03", "08:00");
    expect(expandOccurrences(daily, from, from + 1)).toEqual([from]);
    expect(expandOccurrences(daily, from + 1, lagos("2026-10-03", "20:00"))).toEqual([]);
  });

  it("honours the weekday filter (0 = Sunday)", () => {
    const mondays: ReminderSchedule = { id: "m", times: ["08:00"], days: [1], active: true };
    const out = expandOccurrences(mondays, lagos("2026-10-01", "00:00"), lagos("2026-10-12", "00:00"));
    expect(out).toEqual([lagos("2026-10-05", "08:00")]); // the 12th is outside the half-open range
  });

  it("returns nothing for an inactive schedule and ignores malformed times", () => {
    expect(expandOccurrences({ ...daily, active: false }, 0, 9e12)).toEqual([]);
    const messy: ReminderSchedule = { id: "x", times: ["08:00", "8am", "25:00"], days: null, active: true };
    expect(expandOccurrences(messy, lagos("2026-10-03", "00:00"), lagos("2026-10-04", "00:00"))).toEqual([lagos("2026-10-03", "08:00")]);
  });

  it("de-duplicates repeated times", () => {
    const dup: ReminderSchedule = { id: "d", times: ["08:00", "08:00"], days: null, active: true };
    expect(expandOccurrences(dup, lagos("2026-10-03", "00:00"), lagos("2026-10-04", "00:00"))).toHaveLength(1);
  });
});

describe("applyQuietHours", () => {
  const night = { startHour: 22, endHour: 7 };

  it("moves a night-time reminder to the end of the quiet period", () => {
    expect(applyQuietHours(lagos("2026-10-03", "23:00"), night)).toBe(lagos("2026-10-04", "07:00"));
    expect(applyQuietHours(lagos("2026-10-04", "03:00"), night)).toBe(lagos("2026-10-04", "07:00"));
  });

  it("leaves daytime reminders and the no-quiet-hours case alone", () => {
    const noon = lagos("2026-10-03", "12:00");
    expect(applyQuietHours(noon, night)).toBe(noon);
    expect(applyQuietHours(noon, null)).toBe(noon);
    expect(applyQuietHours(lagos("2026-10-03", "23:00"), { startHour: 5, endHour: 5 })).toBe(lagos("2026-10-03", "23:00"));
  });
});

describe("planRollingWindow", () => {
  const now = lagos("2026-10-03", "10:00");
  const daily: ReminderSchedule = { id: "bp", times: ["08:00", "20:00"], days: null, active: true };

  it("plans only future occurrences, earliest first", () => {
    const plan = planRollingWindow([daily], now, cfg);
    expect(plan[0]).toEqual({ reminderId: "bp", dueAtMs: lagos("2026-10-03", "20:00"), notifyAtMs: lagos("2026-10-03", "20:00") });
    expect(plan.every((o) => o.notifyAtMs > now)).toBe(true);
    expect([...plan].sort((a, b) => a.notifyAtMs - b.notifyAtMs)).toEqual(plan);
  });

  it("caps the plan at the pending limit so the phone never exceeds its own limit", () => {
    const many: ReminderSchedule[] = Array.from({ length: 20 }, (_, i) => ({
      id: `r${i}`,
      times: ["08:00", "12:00", "20:00"],
      days: null,
      active: true,
    }));
    expect(planRollingWindow(many, now, cfg)).toHaveLength(cfg.maxPending);
  });

  it("stays inside the horizon", () => {
    const horizon = now + cfg.horizonDays * 86_400_000;
    expect(planRollingWindow([daily], now, cfg).every((o) => o.notifyAtMs < horizon)).toBe(true);
  });

  it("shifts only the notification time for quiet hours; the due time stays so the reminder still goes missed on schedule", () => {
    const late: ReminderSchedule = { id: "late", times: ["23:00"], days: null, active: true };
    const plan = planRollingWindow([late], now, cfg, { startHour: 22, endHour: 7 });
    expect(plan[0]?.notifyAtMs).toBe(lagos("2026-10-04", "07:00"));
    expect(plan[0]?.dueAtMs).toBe(lagos("2026-10-03", "23:00"));
  });

  it("does not delay a reminder that opts out of quiet hours (medicine reminders)", () => {
    const dose: ReminderSchedule = { id: "dose", times: ["23:00"], days: null, active: true, respectQuietHours: false };
    const plan = planRollingWindow([dose], now, cfg, { startHour: 22, endHour: 7 });
    expect(plan[0]?.notifyAtMs).toBe(lagos("2026-10-03", "23:00"));
  });

  it("collapses occurrences of one reminder that quiet hours push onto the same instant", () => {
    const two: ReminderSchedule = { id: "two", times: ["23:00", "02:00"], days: null, active: true };
    const plan = planRollingWindow([two], now, cfg, { startHour: 22, endHour: 7 });
    const sevenAm = plan.filter((o) => o.notifyAtMs === lagos("2026-10-04", "07:00"));
    expect(sevenAm).toHaveLength(1);
  });
});
