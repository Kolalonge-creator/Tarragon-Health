import {
  DEFAULT_OFFLINE_SYNC_CONFIG as CFG,
  backoffMs,
  classifyFailure,
  effectiveTimeForDisplay,
  isStuck,
  mayFlushUnder,
  pullFloor,
  supportCode,
} from "./outbox-rules";

describe("classifyFailure", () => {
  it.each([
    [{ code: "23505" }, "duplicate"],
    [{ status: 401 }, "auth"],
    [{ message: "JWT expired" }, "auth"],
    [{ message: "Not signed in" }, "auth"],
    [{ message: "Network request failed" }, "network"],
    [{ message: "Couldn't reach the server. Check your connection and try again.", status: 0 }, "network"],
    [{ code: "42501", message: "new row violates row-level security policy" }, "rejected"],
    [{ code: "23502" }, "rejected"],
    [{ code: "22P02" }, "rejected"],
    [{ status: 400, message: "Invalid systolic value" }, "rejected"],
    [{ status: 403 }, "rejected"],
    [{ status: 408 }, "retry"],
    [{ status: 429 }, "retry"],
    [{ status: 500 }, "retry"],
    [{ status: 503 }, "retry"],
    [{ message: "something odd" }, "retry"],
  ])("%j is %s", (info, expected) => {
    expect(classifyFailure(info)).toBe(expected);
  });

  it("a Postgres code beats a network-looking message", () => {
    expect(classifyFailure({ code: "42501", message: "timeout" })).toBe("rejected");
  });
});

describe("backoffMs", () => {
  it("is zero before any attempt, doubles, and caps at 30 minutes", () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(20)).toBe(30 * 60_000);
  });
});

describe("isStuck", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  it("uses the ordinary threshold", () => {
    expect(isStuck({ created_at: ago(11), danger: 0, state: "pending" }, now, CFG)).toBe(false);
    expect(isStuck({ created_at: ago(12), danger: 0, state: "pending" }, now, CFG)).toBe(true);
  });
  it("uses the shorter threshold for a dangerous-looking row", () => {
    expect(isStuck({ created_at: ago(0.5), danger: 1, state: "pending" }, now, CFG)).toBe(false);
    expect(isStuck({ created_at: ago(1), danger: 1, state: "pending" }, now, CFG)).toBe(true);
  });
  it("a rejected row is always stuck", () => {
    expect(isStuck({ created_at: ago(0), danger: 0, state: "rejected" }, now, CFG)).toBe(true);
  });
  it("honours a config change", () => {
    expect(isStuck({ created_at: ago(5), danger: 0, state: "pending" }, now, { ...CFG, stuckNoticeHours: 4 })).toBe(true);
  });
});

describe("mayFlushUnder", () => {
  it("only the owning session may flush a row", () => {
    expect(mayFlushUnder("u1", "u1")).toBe(true);
    expect(mayFlushUnder("u1", "u2")).toBe(false);
    expect(mayFlushUnder("u1", null)).toBe(false);
  });
});

describe("supportCode", () => {
  it("is 8 upper-case characters from the id", () => {
    expect(supportCode("0a1b2c3d-0000-4000-8000-000000000001")).toBe("0A1B2C3D");
  });
});

describe("pullFloor", () => {
  it("is null with no cursor and backs off by the overlap otherwise", () => {
    expect(pullFloor(null, CFG)).toBeNull();
    expect(pullFloor("2026-10-02T12:10:00.000Z", CFG)).toBe("2026-10-02T12:00:00.000Z");
  });
});

describe("effectiveTimeForDisplay", () => {
  const received = "2026-10-02T14:00:00.000Z";
  it("accepts a device time inside the window", () => {
    expect(effectiveTimeForDisplay("2026-10-02T08:00:00.000Z", received, CFG)).toEqual({
      iso: "2026-10-02T08:00:00.000Z",
      basis: "client_bounded",
    });
  });
  it("falls back for too old, and for the future", () => {
    expect(effectiveTimeForDisplay("2026-09-20T08:00:00.000Z", received, CFG).basis).toBe("server");
    expect(effectiveTimeForDisplay("2026-10-04T08:00:00.000Z", received, CFG).basis).toBe("server");
  });
  it("allows a few minutes of clock skew but never stores a time after receipt", () => {
    const r = effectiveTimeForDisplay("2026-10-02T14:03:00.000Z", received, CFG);
    expect(r).toEqual({ iso: received, basis: "client_bounded" });
  });
});
