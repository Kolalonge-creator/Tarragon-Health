import { describe, expect, it } from "@jest/globals";
import { CHANNEL_LABEL, describeShiftTest, formatLatency } from "./shift-start";
import { myShiftStartTestsSchema, shiftStartOverviewSchema, type ShiftStartTest } from "./schemas";

const id = "11111111-1111-4111-8111-111111111111";
const t = (over: Partial<ShiftStartTest> = {}): ShiftStartTest => ({
  id, page_test_id: id, role: "primary", shift_starts_at: "2026-10-17T07:00:00Z", shift_ends_at: "2026-10-17T19:00:00Z", sent_at: "2026-10-17T06:50:00Z",
  deadline_at: "2026-10-17T07:15:00Z", acknowledged_at: null, ack_channel: null, shown_latency_seconds: null, ack_latency_seconds: null, shown: true, undelivered: false, state: "awaiting", ...over,
});

describe("describeShiftTest", () => {
  it("waiting: the clinician may acknowledge", () => {
    const v = describeShiftTest(t());
    expect(v).toMatchObject({ badge: "amber", canAcknowledge: true, instructions: [] });
  });
  it("acknowledged: confirmed, nothing more to do", () => {
    expect(describeShiftTest(t({ state: "acknowledged", acknowledged_at: "2026-10-17T06:52:00Z" }))).toMatchObject({ badge: "green", canAcknowledge: false });
  });
  it("missed but shown: says the shift is not covered and still lets them acknowledge to restore cover", () => {
    const v = describeShiftTest(t({ state: "missed" }));
    expect(v.badge).toBe("red");
    expect(v.headline).toMatch(/not counted as covered/);
    expect(v.canAcknowledge).toBe(true);
  });
  it("undelivered: tells the clinician what to do, and allows acknowledging only if the page is shown on this screen", () => {
    const v = describeShiftTest(t({ undelivered: true, shown: false }));
    expect(v.badge).toBe("red");
    expect(v.canAcknowledge).toBe(false);
    expect(v.instructions.join(" ")).toMatch(/notifications/);
    expect(v.instructions.join(" ")).toMatch(/clinical lead/);
    expect(describeShiftTest(t({ undelivered: true, shown: true, state: "missed" })).canAcknowledge).toBe(true);
    expect(describeShiftTest(t({ undelivered: true, shown: true, state: "missed" })).headline).toMatch(/never reached you/);
  });
  it("backup wording names the role and no copy contains an em dash", () => {
    const all = [t({ role: "backup" }), t({ state: "missed" }), t({ undelivered: true }), t({ state: "acknowledged" })].map(describeShiftTest);
    expect(all[0]?.headline).toMatch(/backup/);
    for (const v of all) expect(JSON.stringify(v)).not.toMatch(/—/);
  });
});

describe("formatLatency and labels", () => {
  it("formats", () => {
    expect(formatLatency(null)).toBe("not recorded");
    expect(formatLatency(42)).toBe("42 s");
    expect(formatLatency(125)).toBe("2 min 05 s");
    expect(CHANNEL_LABEL.push).toBe("phone notification");
  });
});

describe("database answers are parsed", () => {
  it("accepts the shape the function returns and rejects an unknown state", () => {
    const ok = { guard_on: true, grace_minutes: 15, tests: [{ ...t(), ack_channel: null }] };
    expect(myShiftStartTestsSchema.parse(ok).tests).toHaveLength(1);
    expect(() => myShiftStartTestsSchema.parse({ ...ok, tests: [{ ...t(), state: "weird" }] })).toThrow();
    expect(shiftStartOverviewSchema.parse([{ id, rota_id: id, name: "A", role: "backup", shift_starts_at: "2026-10-17T07:00:00Z", sent_at: "2026-10-17T06:50:00Z", deadline_at: "2026-10-17T07:15:00Z", acknowledged_at: null, ack_channel: null, ack_latency_seconds: null, state: "missed" }])).toHaveLength(1);
  });
});
