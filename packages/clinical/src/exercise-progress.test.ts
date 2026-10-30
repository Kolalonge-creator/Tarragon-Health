import { describe, expect, it } from "@jest/globals";
import {
  dailyBars,
  programmeProgress,
  weekTotals,
  weeksInARow,
  type SessionLike,
} from "./exercise-progress";

const s = (
  performed_on: string,
  duration_minutes: number,
  enrollment_id: string | null = null,
): SessionLike => ({
  performed_on,
  duration_minutes,
  enrollment_id,
});

describe("dailyBars", () => {
  it("returns 7 days oldest first ending today, summing several sessions on one day", () => {
    const bars = dailyBars(
      [s("2026-10-29", 20), s("2026-10-29", 10), s("2026-10-25", 30)],
      "2026-10-29",
    );
    expect(bars).toHaveLength(7);
    expect(bars[0].date).toBe("2026-10-23");
    expect(bars[6]).toEqual({ date: "2026-10-29", minutes: 30, sessions: 2 });
    expect(bars.find((b) => b.date === "2026-10-25")?.minutes).toBe(30);
  });

  it("ignores sessions outside the window and crosses month ends", () => {
    const bars = dailyBars(
      [s("2026-10-20", 99), s("2026-11-01", 15)],
      "2026-11-02",
    );
    expect(bars[0].date).toBe("2026-10-27");
    expect(weekTotals(bars)).toEqual({
      sessions: 1,
      minutes: 15,
      activeDays: 1,
    });
  });

  it("is all zeros with no sessions (an honest empty week, not a made-up one)", () => {
    expect(weekTotals(dailyBars([], "2026-10-29"))).toEqual({
      sessions: 0,
      minutes: 0,
      activeDays: 0,
    });
  });
});

describe("weeksInARow", () => {
  it("counts consecutive 7-day blocks holding a session", () => {
    expect(
      weeksInARow(
        [s("2026-10-29", 10), s("2026-10-20", 10), s("2026-10-13", 10)],
        "2026-10-29",
      ),
    ).toBe(3);
  });

  it("does not break the run when this block is still empty", () => {
    expect(
      weeksInARow([s("2026-10-25", 10), s("2026-10-18", 10)], "2026-10-29"),
    ).toBe(2);
  });

  it("breaks on a gap and is zero when nothing recent", () => {
    expect(
      weeksInARow([s("2026-10-29", 10), s("2026-10-08", 10)], "2026-10-29"),
    ).toBe(1);
    expect(weeksInARow([s("2026-09-01", 10)], "2026-10-29")).toBe(0);
    expect(weeksInARow([], "2026-10-29")).toBe(0);
  });
});

describe("programmeProgress", () => {
  it("reports the week within the plan and only this enrolment's sessions", () => {
    const p = programmeProgress(
      "2026-10-15",
      4,
      [
        s("2026-10-16", 20, "a"),
        s("2026-10-20", 30, "a"),
        s("2026-10-21", 99, "b"),
        s("2026-10-22", 5, null),
      ],
      "a",
      "2026-10-29",
    );
    expect(p).toEqual({
      currentWeek: 3,
      totalWeeks: 4,
      planLengthElapsed: false,
      sessionsLogged: 2,
      minutesLogged: 50,
    });
  });

  it("starts at week 1 and caps at the plan length", () => {
    expect(
      programmeProgress("2026-10-29", 6, [], "a", "2026-10-29").currentWeek,
    ).toBe(1);
    const done = programmeProgress("2026-08-01", 4, [], "a", "2026-10-29");
    expect(done.currentWeek).toBe(4);
    expect(done.planLengthElapsed).toBe(true);
  });

  it("copes with an empty plan", () => {
    expect(
      programmeProgress("2026-10-29", 0, [], "a", "2026-10-29").totalWeeks,
    ).toBe(1);
  });
});
