import { computeStreak, type StreakEvent } from "./streaks";
import { addDays } from "./lagos-date";
import type { StreakRulesConfig } from "./s07-config";

// Pinned on purpose: see bp-average.test.ts.
const rules: StreakRulesConfig = { version: 0, freezeEarnEveryDays: 7, freezeCap: 2 };
const TODAY = "2026-10-03"; // a Saturday
const run = (from: number, to: number): string[] => {
  const out: string[] = [];
  for (let d = from; d <= to; d++) out.push(addDays(TODAY, -d));
  return out;
};
const state = (doneDates: string[], events: StreakEvent[] = []) =>
  computeStreak({ doneDates, events, todayLocal: TODAY, rules });

describe("computeStreak", () => {
  it("is empty with no data and never shows a shame state", () => {
    const s = state([]);
    expect(s).toMatchObject({ current: 0, best: 0, freezesAvailable: 0, todayDone: false, proposedFreezeDate: null });
    expect(s.week).toHaveLength(7);
    expect(s.week.map((d) => d.state)).not.toContain("missed");
  });

  it("counts a run through yesterday and does not break it while today is still open", () => {
    const s = state(run(1, 3));
    expect(s.current).toBe(3);
    expect(s.todayDone).toBe(false);
  });

  it("adds today once a reading is logged", () => {
    const s = state([...run(1, 3), TODAY]);
    expect(s.current).toBe(4);
    expect(s.todayDone).toBe(true);
    expect(s.lastDoneDate).toBe(TODAY);
  });

  it("resets after two missed days but keeps the best run", () => {
    const s = state(run(5, 7)); // done 5,6,7 days ago; yesterday and the day before are empty
    expect(s.current).toBe(0);
    expect(s.best).toBe(3);
  });

  it("ignores duplicate dates and future dates", () => {
    const s = state([...run(1, 2), ...run(1, 2), addDays(TODAY, 3)]);
    expect(s.current).toBe(2);
  });

  it("earns a freeze after a full run and proposes it for a missed yesterday, keeping the streak", () => {
    const s = state(run(2, 8)); // 7 logged days, yesterday empty
    expect(s.proposedFreezeDate).toBe(addDays(TODAY, -1));
    expect(s.current).toBe(7);
    expect(s.freezesAvailable).toBe(0);
    expect(s.week.find((d) => d.localDate === addDays(TODAY, -1))?.state).toBe("freeze");
  });

  it("does not freeze when no freeze has been earned", () => {
    const s = state(run(2, 4)); // 3 logged days, yesterday empty
    expect(s.proposedFreezeDate).toBeNull();
    expect(s.current).toBe(0);
  });

  it("caps held freezes", () => {
    const s = state(run(1, 21)); // 21 logged days would earn 3, the cap is 2
    expect(s.freezesAvailable).toBe(rules.freezeCap);
  });

  it("only ever protects yesterday, never an older missed day", () => {
    const s = state([...run(3, 10)]); // 8 logged days, then two empty days
    expect(s.proposedFreezeDate).toBeNull();
    expect(s.current).toBe(0);
  });

  it("honours a recorded freeze that has credit behind it and does not count it as a reading", () => {
    const frozenDay = addDays(TODAY, -2);
    const s = state([...run(3, 9), addDays(TODAY, -1)], [{ localDate: frozenDay, kind: "freeze" }]); // 7 logged, freeze, 1 logged
    expect(s.current).toBe(8); // the frozen day does not add to the count
    expect(s.week.find((d) => d.localDate === frozenDay)?.state).toBe("freeze");
  });

  it("does not honour a recorded freeze that has no credit", () => {
    const s = state([...run(3, 4), addDays(TODAY, -1)], [{ localDate: addDays(TODAY, -2), kind: "freeze" }]);
    expect(s.current).toBe(1);
  });

  it("lets an excused day neither break nor extend the run", () => {
    const s = state([...run(2, 3)], [{ localDate: addDays(TODAY, -1), kind: "excused" }]);
    expect(s.current).toBe(2);
    expect(s.proposedFreezeDate).toBeNull();
  });

  it("lets a logged day win over a freeze recorded on the same day", () => {
    const d = addDays(TODAY, -1);
    const s = state([d], [{ localDate: d, kind: "freeze" }]);
    expect(s.current).toBe(1);
  });

  it("drops malformed dates instead of throwing, and reports how many", () => {
    const s = state([...run(1, 2), "", "2026-13-40", "yesterday"], [{ localDate: "bad", kind: "freeze" }]);
    expect(s.current).toBe(2);
    expect(s.ignoredInvalidDates).toBe(4);
  });

  it("resets the run a day later if a proposed freeze was never recorded (caller contract)", () => {
    const next = computeStreak({ doneDates: run(2, 8), events: [], todayLocal: addDays(TODAY, 1), rules });
    expect(next.current).toBe(0); // the missed day is now two days old and unprotected
    expect(next.proposedFreezeDate).toBeNull();
  });

  it("builds the Monday to Sunday week and counts only logged days", () => {
    const s = state(["2026-09-28", "2026-09-30", TODAY]); // Mon, Wed, Sat
    expect(s.week.map((d) => d.localDate)).toEqual([
      "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
    ]);
    expect(s.week.map((d) => d.state)).toEqual(["done", "open", "done", "open", "open", "done", "future"]);
    expect(s.daysDoneThisWeek).toBe(3);
  });

  it("marks today as open (not missed) until a reading is logged", () => {
    const s = state([]);
    expect(s.week[5]).toEqual({ localDate: TODAY, state: "today" });
  });
});
