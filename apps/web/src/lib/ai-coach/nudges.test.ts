import { describe, expect, it } from "@jest/globals";
import { eligibleForAssistantNudge } from "./nudge-recipients";
import { buildWeeklyReflection, chooseDailyNudge, composeWeeklyReflection, lagosDay, lagosWeekday } from "./nudges";
import { chainable } from "./test-support";
import { lintNotificationText } from "@tarragon/shared";

const none = { recentVitals: [], activeMedications: [], lifestyleProgrammes: [] };

describe("one daily nudge (7.5)", () => {
  it("nudges a reading only for someone who already logs readings", () => {
    expect(chooseDailyNudge({ context: none, readingToday: false, medicinesLoggedToday: false }).kind).toBe("walk");
    const withVitals = { ...none, recentVitals: [{ vitalType: "blood_pressure", value: "130/85", unit: "mmHg", takenAt: "x" }] };
    expect(chooseDailyNudge({ context: withVitals, readingToday: false, medicinesLoggedToday: false }).kind).toBe("log_reading");
    expect(chooseDailyNudge({ context: withVitals, readingToday: true, medicinesLoggedToday: false }).kind).toBe("walk");
  });

  it("falls through reading, medicines, goal, walk in that order", () => {
    const ctx = {
      recentVitals: [{ vitalType: "weight", value: "80", unit: "kg", takenAt: "x" }],
      activeMedications: [{ drugName: "Amlodipine", dose: null, frequency: null }],
      lifestyleProgrammes: [{ conditionLabel: "x", goalTitles: ["Daily walk"], status: "active", hasOpenRedFlag: false }],
    } as never;
    expect(chooseDailyNudge({ context: ctx, readingToday: false, medicinesLoggedToday: false }).kind).toBe("log_reading");
    expect(chooseDailyNudge({ context: ctx, readingToday: true, medicinesLoggedToday: false }).kind).toBe("medicines");
    expect(chooseDailyNudge({ context: ctx, readingToday: true, medicinesLoggedToday: true }).kind).toBe("goal");
  });

  it("a paused or red-flagged programme is never encouraged to push on (the chat rule)", () => {
    for (const p of [{ status: "paused", hasOpenRedFlag: false }, { status: "active", hasOpenRedFlag: true }]) {
      const ctx = { recentVitals: [], activeMedications: [], lifestyleProgrammes: [{ conditionLabel: "x", goalTitles: ["Daily walk"], ...p }] } as never;
      const n = chooseDailyNudge({ context: ctx, readingToday: true, medicinesLoggedToday: true });
      expect(n.kind).toBe("rest");
      expect(n.text).not.toMatch(/walk|goal|step/i);
    }
  });

  it("never echoes a goal title back (it can name a condition)", () => {
    const ctx = { recentVitals: [], activeMedications: [], lifestyleProgrammes: [{ conditionLabel: "x", goalTitles: ["Lower my blood pressure"], status: "active", hasOpenRedFlag: false }] } as never;
    const n = chooseDailyNudge({ context: ctx, readingToday: true, medicinesLoggedToday: true });
    expect(n.kind).toBe("goal");
    expect(n.text).not.toMatch(/blood pressure/i);
  });

  it("never gives a verdict, a number, a dose or an em dash", () => {
    const ctx = {
      recentVitals: [{ vitalType: "weight", value: "80", unit: "kg", takenAt: "x" }],
      activeMedications: [{ drugName: "Amlodipine", dose: null, frequency: null }],
      lifestyleProgrammes: [{ conditionLabel: "x", goalTitles: ["Daily walk"] }],
    } as never;
    for (const [r, m] of [[false, false], [true, false], [true, true]] as const) {
      const n = chooseDailyNudge({ context: ctx, readingToday: r, medicinesLoggedToday: m });
      expect(n.text).not.toMatch(/—|\bgood\b|\bnormal\b|\bcontrolled\b|\bmg\b/i);
    }
  });
});

describe("weekly reflection (7.5)", () => {
  it("states plain counts and compares only to last week", () => {
    const r = composeWeeklyReflection({ readingsThisWeek: 5, readingsLastWeek: 3, medicinesTakenThisWeek: 12, medicinesMissedThisWeek: 2 });
    expect(r.text).toContain("5 readings");
    expect(r.text).toContain("12 of 14");
  });
  it("is kind when nothing was logged", () => {
    const r = composeWeeklyReflection({ readingsThisWeek: 0, readingsLastWeek: 0, medicinesTakenThisWeek: 0, medicinesMissedThisWeek: 0 });
    expect(r.text).toMatch(/did not log/);
    expect(r.text).not.toMatch(/—/);
  });
});

describe("a failed read is not a zero (found in review)", () => {
  it("leaves the weekly reflection out when any count errors, instead of saying 'you logged nothing'", async () => {
    const supabase = { from: () => chainable({ data: null, error: { message: "rls" }, count: null }) } as never;
    expect(await buildWeeklyReflection(supabase, "p1")).toBeNull();
  });
  it("builds it when every count reads", async () => {
    const supabase = { from: () => chainable({ data: null, error: null, count: 3 }) } as never;
    const r = await buildWeeklyReflection(supabase, "p1");
    expect(r?.readingsThisWeek).toBe(3);
  });
});

describe("Lagos day", () => {
  it("rolls over at 23:00 UTC", () => {
    expect(lagosDay(new Date("2026-10-06T22:59:00Z"))).toBe("2026-10-06");
    expect(lagosDay(new Date("2026-10-06T23:00:00Z"))).toBe("2026-10-07");
    expect(lagosWeekday(new Date("2026-10-04T12:00:00Z"))).toBe(0);
  });
});

describe("nudge recipients and the generic notification wording (INV-07)", () => {
  it("a real patient is reached only when the guard is open; a test patient always", () => {
    expect(eligibleForAssistantNudge({ guardOpen: false, role: "patient", isActive: true, isTest: false })).toBe(false);
    expect(eligibleForAssistantNudge({ guardOpen: true, role: "patient", isActive: true, isTest: false })).toBe(true);
    expect(eligibleForAssistantNudge({ guardOpen: false, role: "patient", isActive: true, isTest: true })).toBe(true);
    expect(eligibleForAssistantNudge({ guardOpen: true, role: "clinician", isActive: true, isTest: false })).toBe(false);
    expect(eligibleForAssistantNudge({ guardOpen: true, role: "patient", isActive: false, isTest: false })).toBe(false);
  });

  it("the notification wording seeded for the two templates passes the INV-07 lint", () => {
    for (const text of [
      "Your daily check-in",
      "Your check-in for today is ready. Open the app when you have a minute.",
      "Your week in a minute",
      "Your look back at this week is ready. Open the app to read it.",
    ]) {
      expect(lintNotificationText(text)).toEqual([]);
    }
  });
});
