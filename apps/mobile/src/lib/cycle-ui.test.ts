import { addDays, predictCycle } from "@tarragon/shared";
import { addIsoDays, confidenceDotsLabel, confidenceSentence, isPickable, lastSevenDays, monthGrid, saveFeedback, shiftMonth, statusSentence, statusTone } from "./cycle-ui";
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
