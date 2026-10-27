import { lagosClock, recheckCountdown, recheckDueAtMs } from "./recheck-countdown";

const MIN = 60_000;
// 13:00:00 UTC is 14:00 in Lagos (UTC+1, no daylight saving).
const T0 = Date.UTC(2026, 9, 27, 13, 0, 0);

describe("lagosClock", () => {
  it("shows Lagos time whatever the phone's time zone is", () => {
    expect(lagosClock(T0)).toBe("14:00");
    expect(lagosClock(T0 + 5 * MIN)).toBe("14:05");
    expect(lagosClock(Date.UTC(2026, 9, 27, 23, 30, 0))).toBe("00:30");
  });
});

describe("recheckDueAtMs", () => {
  it("is the reading time plus the wait the rule set asked for", () => {
    expect(recheckDueAtMs(new Date(T0).toISOString(), 5)).toBe(T0 + 5 * MIN);
    expect(recheckDueAtMs(new Date(T0).toISOString(), 120)).toBe(T0 + 120 * MIN);
  });
  it("is null for a wait of zero or less, or a time it cannot read (no guess)", () => {
    expect(recheckDueAtMs(new Date(T0).toISOString(), 0)).toBeNull();
    expect(recheckDueAtMs("garbage", 5)).toBeNull();
    expect(recheckDueAtMs(new Date(T0).toISOString(), Number.NaN)).toBeNull();
  });
});

describe("recheckCountdown", () => {
  const due = T0 + 5 * MIN;
  it("waits: counts whole minutes up, never shows 0 minutes left", () => {
    expect(recheckCountdown(due, T0, null)).toEqual({ state: "waiting", dueAtMs: due, minutesLeft: 5, dueTime: "14:05" });
    expect(recheckCountdown(due, T0 + 4 * MIN + 10_000, null)).toMatchObject({ state: "waiting", minutesLeft: 1 });
    expect(recheckCountdown(due, due - 1, null)).toMatchObject({ state: "waiting", minutesLeft: 1 });
  });
  it("is due from the moment it is due", () => {
    expect(recheckCountdown(due, due, null)).toEqual({ state: "due", dueAtMs: due, dueTime: "14:05" });
    expect(recheckCountdown(due, due + 3 * MIN, null).state).toBe("due");
  });
  it("goes away once the signed window ends (the phone then grades the first reading as if repeated)", () => {
    const expiry = T0 + 15 * MIN;
    expect(recheckCountdown(due, expiry, expiry).state).toBe("due");
    expect(recheckCountdown(due, expiry + 1, expiry).state).toBe("none");
  });
  it("shows nothing when the time is unknown, rather than a made-up one", () => {
    expect(recheckCountdown(null, T0).state).toBe("none");
    expect(recheckCountdown(undefined, T0).state).toBe("none");
    expect(recheckCountdown(Number.NaN, T0).state).toBe("none");
    expect(recheckCountdown(due, Number.NaN).state).toBe("none");
  });
});
