import { evaluateAverageGate, sessionPart, summariseHomeBp, type HomeBpReading } from "./bp-average";
import { lagosTimeToUtcMs } from "./lagos-date";
import type { AverageGateConfig, HomeProtocolConfig } from "./s07-config";

// Pinned on purpose: these tests cover the logic, not the current proposed numbers, so a confirmed registry version does not break them.
const protocol: HomeProtocolConfig = {
  version: 0,
  readingsPerSession: 2,
  minGapMinutes: 1,
  targetDays: 7,
  restMinutes: 5,
  avoidBeforeMinutes: 30,
  morningHours: [4, 12],
  eveningHours: [17, 24],
};
const gate: AverageGateConfig = {
  version: 0,
  windowDays: 7,
  rules: [
    { minReadings: 3, minDays: 3, minPerDay: 1 },
    { minReadings: 4, minDays: 2, minPerDay: 2 },
  ],
};
const NOW = Date.parse("2026-10-03T14:00:00Z"); // 15:00 Lagos on 2026-10-03

const at = (date: string, time: string): number => {
  const ms = lagosTimeToUtcMs(date, time);
  if (ms === null) throw new Error("bad time");
  return ms;
};
const r = (date: string, time: string, systolic: number, diastolic: number): HomeBpReading => ({
  systolic,
  diastolic,
  atMs: at(date, time),
});

describe("sessionPart", () => {
  it("splits the Lagos day into morning, evening and other", () => {
    expect(sessionPart(at("2026-10-03", "03:59"), protocol)).toBe("other");
    expect(sessionPart(at("2026-10-03", "04:00"), protocol)).toBe("morning");
    expect(sessionPart(at("2026-10-03", "11:59"), protocol)).toBe("morning");
    expect(sessionPart(at("2026-10-03", "12:00"), protocol)).toBe("other");
    expect(sessionPart(at("2026-10-03", "17:00"), protocol)).toBe("evening");
    expect(sessionPart(at("2026-10-03", "23:59"), protocol)).toBe("evening");
  });
});

describe("average gate", () => {
  it("is met by one reading a day on three days", () => {
    const g = evaluateAverageGate([1, 1, 1], gate);
    expect(g.met).toBe(true);
    expect(g.shortfall).toBeNull();
  });

  it("is met by two readings a day on two days", () => {
    expect(evaluateAverageGate([2, 2], gate).met).toBe(true);
  });

  it("is not met by one reading a day on two days, and says how much more is needed", () => {
    const g = evaluateAverageGate([1, 1], gate);
    expect(g.met).toBe(false);
    expect(g.shortfall).toEqual({ moreDays: 1, moreReadings: 1, minPerDay: 1 });
  });

  it("is not met by many readings on a single day", () => {
    const g = evaluateAverageGate([5], gate);
    expect(g.met).toBe(false);
    expect(g.shortfall?.moreDays).toBe(1);
  });

  it("also requires the total reading count when a rule asks for more readings than days", () => {
    const strict = { ...gate, rules: [{ minReadings: 5, minDays: 2, minPerDay: 1 }] };
    const g = evaluateAverageGate([1, 1], strict);
    expect(g.met).toBe(false);
    expect(g.shortfall).toEqual({ moreDays: 0, moreReadings: 3, minPerDay: 1 });
    expect(evaluateAverageGate([3, 2], strict).met).toBe(true);
  });

  it("is not met with no readings", () => {
    expect(evaluateAverageGate([], gate).met).toBe(false);
  });
});

describe("summariseHomeBp", () => {
  it("shows no average below the gate", () => {
    const s = summariseHomeBp([r("2026-10-03", "08:00", 150, 95), r("2026-10-02", "08:00", 140, 90)], NOW, protocol, gate);
    expect(s.gate.met).toBe(false);
    expect(s.average).toBeNull();
    expect(s.morningAverage).toBeNull();
    expect(s.readingsInWindow).toBe(2);
  });

  it("averages every reading in the window once the gate is met, rounded to whole mmHg", () => {
    const s = summariseHomeBp(
      [
        r("2026-10-01", "08:00", 140, 90),
        r("2026-10-02", "08:00", 130, 80),
        r("2026-10-03", "08:00", 135, 85),
        r("2026-10-03", "19:00", 138, 88),
      ],
      NOW,
      protocol,
      gate,
    );
    expect(s.gate.met).toBe(true);
    expect(s.average).toEqual({ readings: 4, days: 3, systolic: 136, diastolic: 86 });
    expect(s.morningAverage?.count).toBe(3);
    expect(s.eveningAverage).toEqual({ count: 1, meanSystolic: 138, meanDiastolic: 88 });
  });

  it("groups by day and splits sessions within a day", () => {
    const s = summariseHomeBp(
      [r("2026-10-03", "07:00", 120, 80), r("2026-10-03", "07:02", 124, 82), r("2026-10-03", "20:00", 130, 84)],
      NOW,
      protocol,
      gate,
    );
    expect(s.byDay).toHaveLength(1);
    const day = s.byDay[0];
    expect(day?.count).toBe(3);
    expect(day?.morning).toEqual({ count: 2, meanSystolic: 122, meanDiastolic: 81 });
    expect(day?.evening).toEqual({ count: 1, meanSystolic: 130, meanDiastolic: 84 });
  });

  it("keeps a 7 day window ending today and drops older readings", () => {
    const s = summariseHomeBp([r("2026-09-27", "08:00", 150, 95), r("2026-09-26", "08:00", 150, 95)], NOW, protocol, gate);
    expect(s.windowStart).toBe("2026-09-27");
    expect(s.windowEnd).toBe("2026-10-03");
    expect(s.readingsInWindow).toBe(1); // 09-26 is eight days ago and falls outside
  });

  it("buckets a reading by its Lagos day, not its UTC day", () => {
    // 23:30 UTC on 10-02 is 00:30 Lagos on 10-03.
    const s = summariseHomeBp([{ systolic: 120, diastolic: 80, atMs: Date.parse("2026-10-02T23:30:00Z") }], NOW, protocol, gate);
    expect(s.byDay[0]?.localDate).toBe("2026-10-03");
  });

  it("ignores a second reading closer than the protocol gap (a double save) so it cannot satisfy the gate", () => {
    const s = summariseHomeBp(
      [r("2026-10-02", "08:00", 140, 90), r("2026-10-02", "08:00", 140, 90), r("2026-10-03", "08:00", 138, 88), r("2026-10-03", "08:00", 138, 88)],
      NOW,
      protocol,
      gate,
    );
    expect(s.ignoredCloseReadings).toBe(2);
    expect(s.readingsInWindow).toBe(2);
    expect(s.gate.met).toBe(false); // two real readings on two days, not two on each
  });

  it("counts two readings a full gap apart as two measurements", () => {
    const s = summariseHomeBp([r("2026-10-02", "08:00", 140, 90), r("2026-10-02", "08:01", 138, 88)], NOW, protocol, gate);
    expect(s.ignoredCloseReadings).toBe(0);
    expect(s.readingsInWindow).toBe(2);
  });

  it("ignores readings with a non-finite number instead of poisoning the average", () => {
    const bad: HomeBpReading = { systolic: Number.NaN, diastolic: 80, atMs: at("2026-10-03", "08:00") };
    const s = summariseHomeBp([bad, r("2026-10-03", "09:00", 120, 80)], NOW, protocol, gate);
    expect(s.readingsInWindow).toBe(1);
  });
});
