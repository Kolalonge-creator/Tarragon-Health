import { lagosTimeToUtcMs } from "./lagos-date";
import {
  REMINDER_ID_PREFIX,
  doseSlotKey,
  dosesToPlanInputs,
  planReminderNotifications,
  type PlanInput,
  type ReminderPrefs,
} from "./reminder-plan";
import type { ReminderBehaviourConfig } from "./s07-config";

// Pinned on purpose: these tests cover the planner, not the current proposed numbers.
const cfg: ReminderBehaviourConfig = { version: 0, snoozeMinutes: 30, maxSnoozes: 3, missedAfterMinutes: 120, maxPending: 60, horizonDays: 14 };
const TODAY = "2026-10-04";
const NOW = lagosTimeToUtcMs(TODAY, "10:00") as number;
const at = (date: string, time: string) => lagosTimeToUtcMs(date, time) as number;

const prefs = (over: Partial<ReminderPrefs> = {}): ReminderPrefs => ({ version: 1, bp: [], doseOn: false, quiet: null, ...over });
const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  prefs: prefs(),
  doseSchedules: [],
  handledDoseSlots: new Set(),
  ...over,
});
const bp = (id: string, times: string[], days: number[] | null = null, active = true) => ({ id, times, days, active });

describe("blood pressure reminders", () => {
  it("plans recurring notifications at the chosen Lagos times, future only, earliest first", () => {
    const out = planReminderNotifications(input({ prefs: prefs({ bp: [bp("a", ["08:00", "20:00"])] }) }), NOW, cfg);
    expect(out[0]).toMatchObject({ kind: "bp", notifyAtMs: at(TODAY, "20:00"), dueAtMs: at(TODAY, "20:00") });
    expect(out.every((o) => o.notifyAtMs > NOW)).toBe(true);
    expect([...out].sort((a, b) => a.notifyAtMs - b.notifyAtMs)).toEqual(out);
    expect(out.map((o) => o.notifyAtMs)).toContain(at("2026-10-05", "08:00"));
  });

  it("honours the weekday choice and an off switch", () => {
    const mondaysOnly = planReminderNotifications(input({ prefs: prefs({ bp: [bp("a", ["08:00"], [1])] }) }), NOW, cfg);
    expect(mondaysOnly.map((o) => o.dueAtMs)).toEqual([at("2026-10-05", "08:00"), at("2026-10-12", "08:00")]); // 5 Oct and 12 Oct 2026 are Mondays
    expect(planReminderNotifications(input({ prefs: prefs({ bp: [bp("a", ["08:00"], null, false)] }) }), NOW, cfg)).toEqual([]);
  });

  it("holds a BP reminder in quiet hours until the end of the quiet period, but keeps its due time", () => {
    const out = planReminderNotifications(
      input({ prefs: prefs({ bp: [bp("a", ["23:00"])], quiet: { startHour: 22, endHour: 7 } }) }),
      NOW,
      cfg,
    );
    expect(out[0]).toMatchObject({ notifyAtMs: at("2026-10-05", "07:00"), dueAtMs: at(TODAY, "23:00") });
  });

  it("does nothing with no reminders", () => {
    expect(planReminderNotifications(input(), NOW, cfg)).toEqual([]);
  });
});

describe("medicine reminders", () => {
  const meds = [{ medicationId: "m1", times: ["08:00", "20:00"] }];

  it("are off unless switched on", () => {
    expect(planReminderNotifications(input({ doseSchedules: meds }), NOW, cfg)).toEqual([]);
    expect(planReminderNotifications(input({ prefs: prefs({ doseOn: true }), doseSchedules: meds }), NOW, cfg)[0]).toMatchObject({
      kind: "dose",
      notifyAtMs: at(TODAY, "20:00"),
    });
  });

  it("are never delayed by quiet hours, because a late dose reminder arrives after the dose counts as missed", () => {
    const out = planReminderNotifications(
      input({ prefs: prefs({ doseOn: true, quiet: { startHour: 19, endHour: 7 } }), doseSchedules: meds }),
      NOW,
      cfg,
    );
    expect(out[0]).toMatchObject({ kind: "dose", notifyAtMs: at(TODAY, "20:00"), dueAtMs: at(TODAY, "20:00") });
  });

  it("skip a slot already taken or skipped today, but keep tomorrow's", () => {
    const out = planReminderNotifications(
      input({
        prefs: prefs({ doseOn: true }),
        doseSchedules: meds,
        handledDoseSlots: new Set([doseSlotKey("m1", "20:00")]),
      }),
      NOW,
      cfg,
    );
    const due = out.map((o) => o.dueAtMs);
    expect(due).not.toContain(at(TODAY, "20:00"));
    expect(due).toContain(at("2026-10-05", "20:00"));
  });

  it("read a stored time with seconds as HH:MM", () => {
    const out = planReminderNotifications(
      input({ prefs: prefs({ doseOn: true }), doseSchedules: [{ medicationId: "m1", times: ["20:00:00"] }] }),
      NOW,
      cfg,
    );
    expect(out[0]?.dueAtMs).toBe(at(TODAY, "20:00"));
  });

  it("a slot handled for one medicine does not silence another at the same time", () => {
    const out = planReminderNotifications(
      input({
        prefs: prefs({ doseOn: true }),
        doseSchedules: [
          { medicationId: "m1", times: ["20:00"] },
          { medicationId: "m2", times: ["20:00"] },
        ],
        handledDoseSlots: new Set([doseSlotKey("m1", "20:00")]),
      }),
      NOW,
      cfg,
    );
    const tonight = out.filter((o) => o.dueAtMs === at(TODAY, "20:00"));
    expect(tonight.map((o) => o.identifier)).toEqual([`${REMINDER_ID_PREFIX}dose:m2:${at(TODAY, "20:00")}`]);
  });
});

describe("the plan as a whole", () => {
  it("never exceeds the pending limit however many reminders exist", () => {
    const many = Array.from({ length: 10 }, (_, i) => bp(`r${i}`, ["06:00", "09:00", "12:00", "15:00", "18:00", "21:00"]));
    expect(planReminderNotifications(input({ prefs: prefs({ bp: many }) }), NOW, cfg)).toHaveLength(cfg.maxPending);
  });

  it("gives stable, unique identifiers so re-planning is a safe diff", () => {
    const i = input({ prefs: prefs({ bp: [bp("a", ["08:00", "20:00"])], doseOn: true }), doseSchedules: [{ medicationId: "m1", times: ["08:00"] }] });
    const first = planReminderNotifications(i, NOW, cfg).map((o) => o.identifier);
    const again = planReminderNotifications(i, NOW + 60_000, cfg).map((o) => o.identifier);
    expect(new Set(first).size).toBe(first.length);
    expect(first.every((id) => id.startsWith(REMINDER_ID_PREFIX))).toBe(true);
    // A minute later the same future occurrences keep the same identifiers.
    expect(again.filter((id) => first.includes(id))).toHaveLength(again.length);
  });
});

describe("dosesToPlanInputs", () => {
  it("groups times by medicine and marks every slot that is not pending as handled", () => {
    const out = dosesToPlanInputs([
      { medicationId: "m1", drugName: "A", time: "08:00", status: "taken" },
      { medicationId: "m1", drugName: "A", time: "20:00", status: "pending" },
      { medicationId: "m2", drugName: "B", time: "08:00:00", status: "skipped" },
      { medicationId: "m3", drugName: "C", time: "12:00", status: "missed" },
    ]);
    expect(out.doseSchedules).toEqual([
      { medicationId: "m1", times: ["08:00", "20:00"] },
      { medicationId: "m2", times: ["08:00"] },
      { medicationId: "m3", times: ["12:00"] },
    ]);
    expect([...out.handledDoseSlots].sort()).toEqual(["m1@08:00", "m2@08:00", "m3@12:00"]);
    expect(out.handledDoseSlots.has("m1@20:00")).toBe(false);
  });

  it("is empty for no doses", () => {
    expect(dosesToPlanInputs([])).toEqual({ doseSchedules: [], handledDoseSlots: new Set() });
  });
});
