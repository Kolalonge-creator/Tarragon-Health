import { compare, healthLine, overviewSchema, parsePeriodKey, resolvePeriod } from "./model";

const n = (v: number) => String(v);

describe("parsePeriodKey", () => {
  it("accepts the five periods and falls back to 30 days for anything else", () => {
    expect(parsePeriodKey("7d")).toBe("7d");
    expect(parsePeriodKey(["ytd", "7d"])).toBe("ytd");
    expect(parsePeriodKey(undefined)).toBe("30d");
    expect(parsePeriodKey("1000d")).toBe("30d");
  });
});

describe("resolvePeriod (Africa/Lagos)", () => {
  // 2026-11-07 02:30 UTC is 03:30 in Lagos.
  const now = new Date("2026-11-07T02:30:00Z");

  it("starts 'today' at Lagos midnight, which is 23:00 UTC the day before", () => {
    expect(resolvePeriod("today", now).from.toISOString()).toBe("2026-11-06T23:00:00.000Z");
  });

  it("at 23:30 UTC (00:30 the next day in Lagos) 'today' has already rolled over", () => {
    expect(resolvePeriod("today", new Date("2026-11-07T23:30:00Z")).from.toISOString()).toBe("2026-11-07T23:00:00.000Z");
  });

  it("starts the year at Lagos midnight on 1 January", () => {
    expect(resolvePeriod("ytd", now).from.toISOString()).toBe("2025-12-31T23:00:00.000Z");
  });

  it("rolling periods go back whole days and all end now", () => {
    const p = resolvePeriod("30d", now);
    expect(p.to).toBe(now);
    expect((p.to.getTime() - p.from.getTime()) / 86_400_000).toBe(30);
  });

  it("never returns an empty window, even one minute into the year", () => {
    const p = resolvePeriod("ytd", new Date("2025-12-31T23:00:00Z"));
    expect(p.from.getTime()).toBeLessThan(p.to.getTime());
  });
});

describe("compare", () => {
  it("colours by whether the change is good, not by its direction", () => {
    expect(compare(12, 10, "x", true, n)).toEqual({ text: "↑ 20% on x (was 10)", direction: "up" });
    expect(compare(12, 10, "x", false, n).direction).toBe("down");
    expect(compare(8, 10, "x", false, n)).toEqual({ text: "↓ 20% on x (was 10)", direction: "up" });
  });

  it("gives the old figure instead of an infinite rise from zero", () => {
    expect(compare(5, 0, "x", true, n)).toEqual({ text: "↑ from 0 in x", direction: "up" });
  });

  it("says when nothing changed", () => {
    expect(compare(4, 4, "the 7 days before", true, n)).toEqual({ text: "Same as the 7 days before", direction: "flat" });
  });
});

describe("overviewSchema", () => {
  const win = {
    registrations: 1, memberships_started: 1, started_by_source: { purchase: 1 }, memberships_ended: 0, collected_kobo: 100000,
    collected_count: 1, refunded_kobo: 0, refunded_count: 0, failed_payments: 0, notifications_sent: 4, notifications_failed: 1,
  };
  const ok = {
    window: { from: "a", to: "b", previous_from: "c", previous_to: "a" },
    current: win,
    previous: win,
    snapshot: { computed_at: "t", registered_patients: 10, active_memberships: 3, active_by_source: {}, free_patients: 7, ending_next_30d: 0 },
  };

  it("accepts the function's shape", () => {
    expect(overviewSchema.safeParse(ok).success).toBe(true);
  });

  it("rejects an empty object, so a refused or broken read can never be drawn as zeros", () => {
    expect(overviewSchema.safeParse({}).success).toBe(false);
  });
});

describe("healthLine", () => {
  const t = (iso: string) => `at ${iso}`;
  it("calls a live answer operational and a missed one failed", () => {
    expect(healthLine({ status: "up", latency_ms: 42 }, t)).toEqual({ state: "operational", evidence: "Answered a live check in 42 ms" });
    expect(healthLine({ status: "down", latency_ms: 0 }, t).state).toBe("failed");
  });
  it("never calls a key that is merely set operational", () => {
    expect(healthLine({ status: "configured", evidence: "env" }, t).state).toBe("unknown");
    expect(healthLine({ status: "configured" }, t).state).toBe("unknown");
  });
  it("counts a real recent send as operational, and an optional service that is absent as not configured", () => {
    expect(healthLine({ status: "configured", evidence: "recent_send", last_sent_at: "x" }, t)).toEqual({ state: "operational", evidence: "Last message sent at x" });
    expect(healthLine({ status: "not_deployed", latency_ms: 0 }, t).state).toBe("not_configured");
    expect(healthLine({ status: "unconfigured" }, t).state).toBe("not_configured");
  });
});
