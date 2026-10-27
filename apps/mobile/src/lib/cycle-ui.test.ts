import { addDays, predictCycle } from "@tarragon/shared";
import { draftFor, draftFromLog, guardedAction, refreshFailureView, withDraft, withoutDraft, addIsoDays, confidenceDotsLabel, confidenceSentence, isPickable, lastSevenDays, monthGrid, saveFeedback, shiftMonth, statusSentence, statusTone } from "./cycle-ui";
import { listenClipsFor } from "./cycle-listen";

const today = "2026-10-10";
const run = (starts: number[]) =>
  predictCycle({
    periods: starts.map((n) => ({ startDate: addDays(today, n), endDate: addDays(today, n + 4) })),
    today,
    lifeStage: "menstruating",
    selfReportedCycleLengthDays: null,
    heavyFlowDates: [],
    conceptionPlanning: false,
  });

describe("status sentence", () => {
  it("asks for a first period when there is no history", () => {
    expect(statusSentence(run([]))).toBe("Log your first period and we will show what to expect.");
    expect(statusTone(run([]))).toBe("grey");
  });
  it("counts down in plain words", () => {
    expect(statusSentence(run([-97, -69, -41, -13]))).toMatch(/^Period expected in about \d+ days\.$/);
  });
  it("is calm and amber when late, with no exclamation mark", () => {
    const p = run([-120, -92, -64, -36]);
    expect(statusSentence(p)).toMatch(/later than the estimate/);
    expect(statusSentence(p)).not.toMatch(/!/);
    expect(statusTone(p)).toBe("amber");
  });
});

describe("confidence", () => {
  it("is words plus a dot count that comes from the engine level", () => {
    expect(confidenceSentence("low")).toBe("Early estimate. It gets better after 3 cycles.");
    expect(confidenceDotsLabel("none")).toBe("Confidence: 0 of 3 dots.");
    expect(confidenceDotsLabel("medium")).toBe("Confidence: 2 of 3 dots.");
    expect(confidenceDotsLabel("high")).toBe("Confidence: 3 of 3 dots.");
  });
});

describe("week strip and month grid", () => {
  it("gives seven days ending today", () => {
    const days = lastSevenDays(today);
    expect(days).toHaveLength(7);
    expect(days[6]).toMatchObject({ iso: today, isToday: true });
    expect(days[0]?.iso).toBe(addIsoDays(today, -6));
  });
  it("puts the first of the month in its Monday-first column", () => {
    const rows = monthGrid(2026, 9); // October 2026 starts on a Thursday
    expect(rows[0]?.findIndex((c) => c?.day === 1)).toBe(3);
    expect(rows.every((r) => r.length === 7)).toBe(true);
    expect(rows.flat().filter(Boolean)).toHaveLength(31);
  });
  it("steps across a year end", () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, monthIndex: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, monthIndex: 11 });
  });
  it("does not let a future day be picked", () => {
    expect(isPickable(today, today)).toBe(true);
    expect(isPickable(addIsoDays(today, 1), today)).toBe(false);
  });
});

describe("save feedback never claims a save that did not happen", () => {
  it("says saved on success", () => expect(saveFeedback({ ok: true, heldOnPhone: false, offline: false })).toBe("saved"));
  it("only says queued when something was held on the phone", () => {
    expect(saveFeedback({ ok: false, heldOnPhone: true, offline: true })).toBe("queued");
    expect(saveFeedback({ ok: false, heldOnPhone: false, offline: true })).toBe("not_sent_offline");
    expect(saveFeedback({ ok: false, heldOnPhone: false, offline: false })).toBe("failed");
  });
});

describe("listen", () => {
  it("lists no clip until one is recorded and signed off", () => {
    expect(listenClipsFor("status")).toBeNull();
  });
});

describe("a period in progress", () => {
  it("says it started N days ago, never a countdown", () => {
    const p = run([-97, -69, -41, -2]);
    expect(statusSentence(p, { startedOn: addIsoDays(today, -2), today })).toBe("Your period started 2 days ago.");
    expect(statusSentence(p, { startedOn: addIsoDays(today, -1), today })).toBe("Your period started 1 day ago.");
    expect(statusSentence(p, { startedOn: today, today })).toBe("Your period started today.");
    expect(statusSentence(p, { startedOn: addIsoDays(today, -2), today })).not.toMatch(/expected/);
  });
});

describe("day-log draft survives closing the sheet", () => {
  const saved = { flow: "light", symptoms: ["cramps"], moods: [], notes: "x", basal_body_temperature_c: 36.5, ovulation_test_result: null };
  it("opens with the saved log when there is no draft", () => {
    expect(draftFor({}, "2026-10-09", saved)).toEqual(draftFromLog(saved));
    expect(draftFromLog(null)).toEqual({ flow: null, symptoms: [], moods: [], notes: "", bbt: "", ovulationTest: null });
  });
  it("restores unsaved choices for that date only, and clears them after a save", () => {
    const edited = { ...draftFromLog(saved), flow: "heavy", notes: "typed" };
    let drafts = withDraft({}, "2026-10-09", edited);
    expect(draftFor(drafts, "2026-10-09", saved)).toEqual(edited);
    expect(draftFor(drafts, "2026-10-08", null)).toEqual(draftFromLog(null));
    drafts = withoutDraft(drafts, "2026-10-09");
    expect(draftFor(drafts, "2026-10-09", saved)).toEqual(draftFromLog(saved));
  });
});

describe("failures never hide a save or leave a button dead", () => {
  it("turns a throw into a calm failure", async () => {
    const r = await guardedAction(async () => {
      throw new Error("boom");
    });
    expect(r).toEqual({ ok: false, error: "Could not save that just now. Please try again." });
    expect(await guardedAction(async () => ({ ok: true }))).toEqual({ ok: true });
  });
  it("a failed refresh after data is on screen keeps the screen", () => {
    expect(refreshFailureView(true)).toBe("saved_note");
    expect(refreshFailureView(false)).toBe("full_error");
  });
});
