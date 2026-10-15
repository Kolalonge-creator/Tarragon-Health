import { assessHomeCheck, parseHomeBpConfig, type HomeBpReading } from "@tarragon/clinical";
import { getProposedConfig } from "@tarragon/shared";
import { buildHomeCheckView, outcomeForError, parseCompleteResult, todayLine, type StoredHomeCheck } from "./home-check-model";

const cfg = parseHomeBpConfig(1, getProposedConfig("bp.home_programme").value);
const ms = (iso: string) => Date.parse(iso);
const rd = (iso: string): HomeBpReading => ({ systolic: 120, diastolic: 78, atMs: ms(iso) });
const day = (d: string): HomeBpReading[] => [rd(`${d}T06:00:00Z`), rd(`${d}T06:01:30Z`), rd(`${d}T18:00:00Z`), rd(`${d}T18:01:30Z`)];
const three = [...day("2026-10-01"), ...day("2026-10-02"), ...day("2026-10-03")];
const stored: StoredHomeCheck = { startDate: "2026-10-01" };
const assess = (readings: HomeBpReading[], now: string) => assessHomeCheck({ readings, startDate: "2026-10-01", nowMs: ms(now) }, cfg);

describe("home check card state", () => {
  it("is hidden unless the guard is known to be open", () => {
    expect(buildHomeCheckView({ guardOpen: null, stored: null, assessment: null })).toEqual({ kind: "hidden" });
    expect(buildHomeCheckView({ guardOpen: false, stored, assessment: assess(three, "2026-10-03T20:00:00Z") })).toEqual({ kind: "hidden" });
  });

  it("offers a start when nothing is stored, or the stored start has no assessment", () => {
    expect(buildHomeCheckView({ guardOpen: true, stored: null, assessment: null })).toEqual({ kind: "start" });
    expect(buildHomeCheckView({ guardOpen: true, stored, assessment: null })).toEqual({ kind: "start" });
  });

  it("runs while there are too few readings and the window is open, and says what is missing", () => {
    const a = assess(day("2026-10-01"), "2026-10-01T20:00:00Z");
    const v = buildHomeCheckView({ guardOpen: true, stored, assessment: a });
    expect(v.kind).toBe("running");
    expect(a.mean).toBeNull();
  });

  it("is ready once the protocol is complete, with the send queued only after the patient asked", () => {
    const a = assess(three, "2026-10-03T20:00:00Z");
    expect(buildHomeCheckView({ guardOpen: true, stored, assessment: a })).toMatchObject({ kind: "ready", queued: false });
    expect(buildHomeCheckView({ guardOpen: true, stored: { ...stored, sendRequestedAt: "2026-10-03T20:00:00Z" }, assessment: a })).toMatchObject({ kind: "ready", queued: true });
    // the server counted fewer readings than the phone: the card says so and the send is no longer queued
    expect(buildHomeCheckView({ guardOpen: true, stored: { ...stored, serverShort: { readings: 9, days: 3 } }, assessment: a })).toMatchObject({
      kind: "ready",
      queued: false,
      serverShort: { readings: 9, days: 3 },
    });
  });

  it("ends short when the window is over and the protocol never completed, with no average", () => {
    const a = assess(day("2026-10-01"), "2026-10-09T08:00:00Z");
    expect(buildHomeCheckView({ guardOpen: true, stored, assessment: a })).toMatchObject({ kind: "ended_short" });
    expect(a.mean).toBeNull();
  });

  it("shows the sent result only after the server confirmed it", () => {
    const result = { readings: 12, days: 3, systolic: 118, diastolic: 78, band: "borderline" as const };
    const a = assess(three, "2026-10-03T20:00:00Z");
    expect(buildHomeCheckView({ guardOpen: true, stored: { ...stored, submittedAt: "2026-10-03T21:00:00Z", result }, assessment: a })).toEqual({ kind: "sent", result });
    expect(buildHomeCheckView({ guardOpen: true, stored: { ...stored, submittedAt: "2026-10-03T21:00:00Z" }, assessment: a }).kind).toBe("ready");
  });
});

describe("today's line", () => {
  it("names the session still to do", () => {
    expect(todayLine(assess([], "2026-10-02T08:00:00Z"))).toBe("both");
    expect(todayLine(assess(day("2026-10-02").slice(0, 2), "2026-10-02T08:00:00Z"))).toBe("evening");
    expect(todayLine(assess(day("2026-10-02").slice(2), "2026-10-02T08:00:00Z"))).toBe("morning");
    expect(todayLine(assess(day("2026-10-02"), "2026-10-02T20:00:00Z"))).toBe("done");
  });
});

describe("the server answer", () => {
  it("accepts a recorded result and an incomplete one", () => {
    expect(parseCompleteResult({ complete: true, readings: 12, days: 3, systolic: 138, diastolic: 86, band: "above_home_level" })).toEqual({
      kind: "recorded",
      result: { readings: 12, days: 3, systolic: 138, diastolic: 86, band: "above_home_level" },
    });
    expect(parseCompleteResult({ complete: false, readings: 3, days: 2 })).toEqual({ kind: "not_enough", readings: 3, days: 2 });
    expect(parseCompleteResult({ complete: false })).toEqual({ kind: "not_enough", readings: 0, days: 0 });
  });

  it("refuses anything malformed rather than guessing", () => {
    for (const bad of [null, "x", [], {}, { complete: "yes" }, { complete: true }, { complete: true, readings: 12, days: 3, systolic: 1, diastolic: 1, band: "great" }, { complete: true, readings: "12", days: 3, systolic: 1, diastolic: 1, band: "borderline" }]) {
      expect(parseCompleteResult(bad)).toBeNull();
    }
  });

  it("maps 55000 to closed and every other failure to offline (retried later)", () => {
    expect(outcomeForError({ code: "55000" })).toEqual({ kind: "closed" });
    expect(outcomeForError({ code: "08006" })).toEqual({ kind: "offline" });
    expect(outcomeForError(null)).toEqual({ kind: "offline" });
  });
});
