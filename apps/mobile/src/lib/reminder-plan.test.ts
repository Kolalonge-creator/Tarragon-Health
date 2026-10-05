import { lagosTimeToUtcMs } from "./lagos-date";
import {
  REMINDER_ID_PREFIX,
  planCoverage,
  withLanguage,
  planReminderNotifications,
  type PlanInput,
  type ReminderPrefs,
} from "./reminder-plan";
import type { ReminderBehaviourConfig } from "./s07-config";

// Pinned on purpose: these tests cover the planner, not the current proposed numbers.
const cfg: ReminderBehaviourConfig = { version: 0, snoozeMinutes: 30, maxSnoozes: 3, missedAfterMinutes: 120, maxPending: 44, maxPendingBp: 18, horizonDays: 14 };
const TODAY = "2026-10-04";
const NOW = lagosTimeToUtcMs(TODAY, "10:00") as number;
const at = (date: string, time: string) => lagosTimeToUtcMs(date, time) as number;

const prefs = (over: Partial<ReminderPrefs> = {}): ReminderPrefs => ({ version: 1, bp: [], quiet: null, ...over });
const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  prefs: prefs(),
  ...over,
});
const bp = (id: string, times: string[], days: number[] | null = null, active = true) => ({ id, times, days, active });

describe("blood pressure reminders", () => {
  it("plans recurring notifications at the chosen Lagos times, future only, earliest first", () => {
    const out = planReminderNotifications(input({ prefs: prefs({ bp: [bp("a", ["08:00", "20:00"])] }) }), NOW, cfg);
    expect(out[0]).toMatchObject({ notifyAtMs: at(TODAY, "20:00"), dueAtMs: at(TODAY, "20:00") });
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

describe("medicine reminders are not planned here", () => {
  it("a stored doseOn from an earlier build changes nothing: this planner only ever produces blood pressure reminders", () => {
    const withOldFlag = { version: 1, bp: [], quiet: null, doseOn: true } as unknown as ReminderPrefs;
    expect(planReminderNotifications(input({ prefs: withOldFlag }), NOW, cfg)).toEqual([]);
  });

  it("every identifier is under this feature's prefix and never one of S08's \"dose|\" identifiers", () => {
    const out = planReminderNotifications(input({ prefs: prefs({ bp: [bp("a", ["08:00", "20:00"])] }) }), NOW, cfg);
    expect(out.length).toBeGreaterThan(0);
    for (const o of out) {
      expect(o.identifier.startsWith(REMINDER_ID_PREFIX)).toBe(true);
      expect(o.identifier.startsWith("dose|")).toBe(false);
    }
  });

  it("quiet hours hold blood pressure reminders only", () => {
    const out = planReminderNotifications(input({ prefs: prefs({ bp: [bp("a", ["23:00"])], quiet: { startHour: 22, endHour: 7 } }) }), NOW, cfg);
    expect(out.every((o) => o.notifyAtMs >= o.dueAtMs)).toBe(true);
  });
});

describe("the plan as a whole", () => {
  it("never exceeds its own budget however many reminders exist, so it cannot crowd out the medicine reminders that share the phone's limit", () => {
    const many = Array.from({ length: 10 }, (_, i) => bp(`r${i}`, ["06:00", "09:00", "12:00", "15:00", "18:00", "21:00"]));
    const out = planReminderNotifications(input({ prefs: prefs({ bp: many }) }), NOW, cfg);
    expect(out).toHaveLength(cfg.maxPendingBp);
    expect(out.length).toBeLessThan(cfg.maxPending);
  });

  it("gives stable, unique identifiers so re-planning is a safe diff", () => {
    const i = input({ prefs: prefs({ bp: [bp("a", ["08:00", "20:00"])] }) });
    const first = planReminderNotifications(i, NOW, cfg).map((o) => o.identifier);
    const again = planReminderNotifications(i, NOW + 60_000, cfg).map((o) => o.identifier);
    expect(new Set(first).size).toBe(first.length);
    expect(first.every((id) => id.startsWith(REMINDER_ID_PREFIX))).toBe(true);
    // A minute later the same future occurrences keep the same identifiers.
    expect(again.filter((id) => first.includes(id))).toHaveLength(again.length);
  });
});

describe("withLanguage", () => {
  it("changes every identifier when the language changes, so scheduled text is refreshed", () => {
    const plan = planReminderNotifications(input({ prefs: prefs({ bp: [bp("a", ["20:00"])] }) }), NOW, cfg);
    const en = withLanguage(plan, "en").map((p) => p.identifier);
    const pcm = withLanguage(plan, "pcm").map((p) => p.identifier);
    expect(en.every((id) => id.endsWith("@en"))).toBe(true);
    expect(en.filter((id) => pcm.includes(id))).toEqual([]);
    expect(en.every((id) => id.startsWith(REMINDER_ID_PREFIX))).toBe(true);
  });
});

describe("planCoverage", () => {
  it("says when the cap was hit and how far the plan reaches", () => {
    const many = Array.from({ length: 10 }, (_, i) => bp(`r${i}`, ["06:00", "09:00", "12:00", "15:00", "18:00", "21:00"]));
    const plan = planReminderNotifications(input({ prefs: prefs({ bp: many }) }), NOW, cfg);
    const cov = planCoverage(plan, cfg);
    expect(cov.capped).toBe(true);
    expect(cov.coveredUntilMs).toBe(plan[plan.length - 1]?.notifyAtMs);
  });

  it("is not capped for a once-a-day reminder (14 days fits the budget), is capped at twice a day, and has no end for an empty plan", () => {
    const plan = planReminderNotifications(input({ prefs: prefs({ bp: [bp("a", ["08:00"])] }) }), NOW, cfg);
    expect(planCoverage(plan, cfg).capped).toBe(false);
    const twiceDaily = planReminderNotifications(input({ prefs: prefs({ bp: [bp("a", ["08:00", "20:00"])] }) }), NOW, cfg);
    expect(planCoverage(twiceDaily, cfg).capped).toBe(true);
    expect(planCoverage([], cfg)).toEqual({ capped: false, coveredUntilMs: null });
  });
});
