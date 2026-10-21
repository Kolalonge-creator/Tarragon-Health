import { en } from "@tarragon/i18n";
import { buildToday, HOME_CARD_CODES, parseHomeCardConfig } from "@tarragon/clinical/today";
import { getProposedConfig } from "@tarragon/shared";
import { buildFacts, CARD_TARGET, cardAction, cardDone, cardTitle, dayStateKey, doneDatesFrom, readinessView, streakLines, withFreeze, type PlanSources } from "./home-plan-model";
import { computeStreak } from "./streaks";
import type { TodayItem, TodayList } from "./today-model";

const ENTRY = getProposedConfig("today.home_cards");
const CFG = parseHomeCardConfig(ENTRY.version, ENTRY.value);

const item = (over: Partial<TodayItem>): TodayItem => ({
  id: "x",
  source: "task",
  kind: "log_bp",
  title: { text: "t" },
  due: { key: "today.due.today" },
  status: "due",
  target: "care",
  dueAtMs: null,
  ...over,
});
const list = (open: TodayItem[], done: TodayItem[] = []): TodayList => ({ open, shownOpen: open, moreCount: 0, done, total: open.length + done.length });
const src = (over: Partial<PlanSources> & { open?: TodayItem[]; done?: TodayItem[]; bp?: boolean; hist?: boolean }): PlanSources => ({
  today: { list: list(over.open ?? [], over.done ?? []), bpLoggedToday: over.bp ?? false, bpHistory: over.hist ?? true },
  hasDevice: false,
  activityWeek: null,
  lessonAvailable: false,
  streakAvailable: false,
  weeklyAvailable: false,
  readinessAvailable: false,
  ...over,
});

describe("buildFacts", () => {
  it("counts open and overdue tasks and pending doses, and reads blood pressure logged today", () => {
    const f = buildFacts(
      src({
        open: [item({ id: "a", status: "overdue" }), item({ id: "b" }), item({ id: "d", source: "dose", kind: "take_medicine" })],
        done: [item({ id: "e", source: "dose", kind: "take_medicine", status: "done" })],
        bp: true,
      }),
    );
    expect(f.task).toEqual({ openCount: 2, overdueCount: 1 });
    expect(f.medicines).toEqual({ pendingCount: 1 });
    expect(f.readings).toEqual({ loggedToday: true });
  });

  it("has no task or medicine fact when there are none (the cards stay hidden)", () => {
    const f = buildFacts(src({}));
    expect(f.task).toBeNull();
    expect(f.medicines).toBeNull();
    expect(f.readings).toEqual({ loggedToday: false });
  });

  it("shows the readings card only to someone who logs blood pressure or has a task to", () => {
    expect(buildFacts(src({ hist: false })).readings).toBeNull();
    expect(buildFacts(src({ hist: true })).readings).toEqual({ loggedToday: false });
    expect(buildFacts(src({ hist: false, open: [item({ kind: "log_bp" })] })).readings).toEqual({ loggedToday: false });
  });

  it("keeps a task card when only a finished task exists, with nothing open", () => {
    const f = buildFacts(src({ done: [item({ status: "done" })] }));
    expect(f.task).toEqual({ openCount: 0, overdueCount: 0 });
  });

  it("reads the goal from the week's minutes, and hides it without a goal", () => {
    expect(buildFacts(src({ activityWeek: { activeMinutes: 160, goalMinutes: 150 } })).goal).toEqual({ metToday: true });
    expect(buildFacts(src({ activityWeek: { activeMinutes: 20, goalMinutes: 150 } })).goal).toEqual({ metToday: false });
    expect(buildFacts(src({ activityWeek: { activeMinutes: 20, goalMinutes: 0 } })).goal).toBeNull();
    expect(buildFacts(src({})).goal).toBeNull();
  });

  it("passes the optional slots through as null when unavailable", () => {
    const f = buildFacts(src({}));
    expect([f.lesson, f.streak, f.weekly, f.readiness]).toEqual([null, null, null, null]);
    const on = buildFacts(src({ lessonAvailable: true, streakAvailable: true, weeklyAvailable: true, readinessAvailable: true, hasDevice: true }));
    expect([on.lesson, on.streak, on.weekly, on.readiness].every((x) => x?.available === true)).toBe(true);
    expect(on.hasDevice).toBe(true);
  });

  it("feeds today-build and never yields more than two primary actions", () => {
    const f = buildFacts(
      src({
        open: [item({ id: "a", status: "overdue" }), item({ id: "d", source: "dose", kind: "take_medicine" })],
        activityWeek: { activeMinutes: 0, goalMinutes: 150 },
        lessonAvailable: true,
      }),
    );
    expect(buildToday(CFG, f).primary.length).toBeLessThanOrEqual(2);
  });
});

describe("card words", () => {
  it("every card has valid targets and every key it can name exists in English", () => {
    for (const code of HOME_CARD_CODES) {
      expect(CARD_TARGET[code]).toBeTruthy();
      for (const k of [cardTitle(code), cardAction(code), cardDone(code)]) if (k) expect(Object.keys(en)).toContain(k);
    }
    expect(cardTitle("streak")).toBeNull();
    expect(cardAction("readiness")).toBeNull();
    expect(cardDone("lesson")).toBeNull();
    expect(cardDone("medicines")).toBe("today.card.medicines.done");
  });
});

describe("streak words: calm, with no shame state", () => {
  const rules = { version: 1, freezeEarnEveryDays: 7, freezeCap: 2 };
  const days = (from: number, n: number) => Array.from({ length: n }, (_, i) => `2026-10-${String(from + i).padStart(2, "0")}`);

  it("starts gently with no days", () => {
    const s = computeStreak({ doneDates: [], events: [], todayLocal: "2026-10-21", rules });
    const l = streakLines(s);
    expect(l.headline).toEqual({ key: "streak.start" });
    expect(l.notes).toEqual([{ key: "streak.today_open" }]);
  });

  it("counts one day, many days and the best so far", () => {
    expect(streakLines(computeStreak({ doneDates: ["2026-10-21"], events: [], todayLocal: "2026-10-21", rules })).headline).toEqual({ key: "streak.current_one" });
    const run = computeStreak({ doneDates: [...days(1, 8), ...days(14, 8)], events: [], todayLocal: "2026-10-21", rules });
    expect(streakLines(run).headline).toEqual({ key: "streak.current_other", params: { count: run.current } });
    const broken = computeStreak({ doneDates: [...days(1, 8), "2026-10-21"], events: [], todayLocal: "2026-10-21", rules });
    expect(streakLines(broken).notes.map((n) => n.key)).toContain("streak.best");
  });

  it("says a saved rest day covered yesterday, and how many rest days are saved", () => {
    const covered = computeStreak({ doneDates: days(8, 13).filter((d) => d !== "2026-10-20"), events: [], todayLocal: "2026-10-21", rules });
    expect(covered.proposedFreezeDate).toBe("2026-10-20");
    expect(streakLines(covered).notes.map((n) => n.key)).toContain("streak.freeze_used");
    const one = computeStreak({ doneDates: days(14, 8), events: [], todayLocal: "2026-10-21", rules });
    expect(streakLines(one).notes.map((n) => n.key)).toContain("streak.freeze_have_one");
    const two = computeStreak({ doneDates: days(1, 21), events: [], todayLocal: "2026-10-21", rules });
    expect(streakLines(two).notes).toContainEqual({ key: "streak.freeze_have_other", params: { count: 2 } });
    const none = computeStreak({ doneDates: days(18, 4), events: [], todayLocal: "2026-10-21", rules });
    expect(streakLines(none).notes.map((n) => n.key)).toContain("streak.freeze_none");
    expect(streakLines(none).notes.map((n) => n.key)).toContain("streak.today_done");
  });

  it("never uses a shame word and every day state has a word", () => {
    for (const k of Object.keys(en).filter((x) => x.startsWith("streak."))) expect(en[k as keyof typeof en]).not.toMatch(/miss|fail|lost|broke|behind|zero/i);
    for (const s of ["done", "freeze", "excused", "today", "open", "future"] as const) expect(Object.keys(en)).toContain(dayStateKey(s));
  });

  it("buckets logged times into Lagos days and skips unreadable ones", () => {
    expect(doneDatesFrom(["2026-10-20T23:30:00Z", "2026-10-21T08:00:00Z", "junk", null, undefined])).toEqual(["2026-10-21"]);
  });

  it("stores a freeze once and keeps the list short", () => {
    expect(withFreeze(["2026-10-01"], "2026-10-02")).toEqual(["2026-10-01", "2026-10-02"]);
    expect(withFreeze(["2026-10-01"], "2026-10-01")).toEqual(["2026-10-01"]);
    expect(withFreeze(["a", "b", "c"], "d", 2)).toEqual(["c", "d"]);
  });
});

describe("readinessView", () => {
  it("is null when there is nothing to say", () => {
    expect(readinessView({ kind: "none", reason: "no_device" })).toBeNull();
  });
  it("gives plain words for each band and the reasons that moved, and every key exists", () => {
    const steady = readinessView({ kind: "band", band: "steady", moves: [] });
    const easy = readinessView({ kind: "band", band: "take_it_easier", moves: [{ signal: "sleep", move: "unhelpful" }, { signal: "resting_hr", move: "unhelpful" }] });
    const rested = readinessView({ kind: "band", band: "rested", moves: [{ signal: "hrv", move: "helpful" }] });
    expect(steady?.band).toBe("readiness.band.steady");
    expect(easy?.reasons).toEqual(["readiness.move.sleep.unhelpful", "readiness.move.resting_hr.unhelpful"]);
    expect(rested?.line).toBe("readiness.line.rested");
    for (const v of [steady, easy, rested]) for (const k of [v!.band, v!.line, ...v!.reasons]) expect(Object.keys(en)).toContain(k);
  });
  it("makes no medical claim: the caption says estimate, not advice, no diagnosis", () => {
    expect(en["readiness.caption"]).toMatch(/estimate/);
    expect(en["readiness.caption"]).toMatch(/not medical advice/);
    for (const k of Object.keys(en).filter((x) => x.startsWith("readiness."))) expect(en[k as keyof typeof en]).not.toMatch(/diagnos\w* (a|an|you)\b|you have|disease|treat/i);
  });
});
