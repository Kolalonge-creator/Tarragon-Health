import { describe, expect, it } from "@jest/globals";
import { errorWord, parseIdKeys, processorState, type HeartbeatRow } from "./model";

const NOW = new Date("2026-10-20T12:00:00Z");
const row = (o: Partial<HeartbeatRow> = {}): HeartbeatRow => ({ is_active: true, last_success_at: "2026-10-20T11:59:00Z", oldest_due_seconds: 0, lag_incident_open: false, ...o });

describe("processorState", () => {
  it("is unreadable when the read failed, never ok", () => {
    expect(processorState([], true, NOW)).toBe("unreadable");
    expect(processorState([row()], true, NOW)).toBe("unreadable");
  });
  it("says never when nothing has ever completed, or there are no subscribers", () => {
    expect(processorState([], false, NOW)).toBe("never");
    expect(processorState([row({ last_success_at: null }), row({ last_success_at: null })], false, NOW)).toBe("never");
  });
  it("ignores switched-off subscribers", () => {
    expect(processorState([row({ is_active: false }), row({ last_success_at: null })], false, NOW)).toBe("never");
  });
  it("is stalled with an open lag incident", () => {
    expect(processorState([row({ lag_incident_open: true })], false, NOW)).toBe("stalled");
  });
  it("is stalled when work has been due for ten minutes and nothing completed in the last ten", () => {
    expect(processorState([row({ oldest_due_seconds: 3600, last_success_at: "2026-10-20T08:00:00Z" })], false, NOW)).toBe("stalled");
    // work due for 5000 s, last success 4000 s ago: the processor has been idle for over an hour
    expect(processorState([row({ oldest_due_seconds: 5000, last_success_at: "2026-10-20T10:53:20Z" })], false, NOW)).toBe("stalled");
  });
  it("is ok when work waited but the processor completed something in the last ten minutes", () => {
    expect(processorState([row({ oldest_due_seconds: 5000, last_success_at: "2026-10-20T11:59:30Z" })], false, NOW)).toBe("ok");
    expect(processorState([row()], false, NOW)).toBe("ok");
  });
  it("flags partner subscribers that never succeeded while the rest of the bus is healthy", () => {
    const partner = row({ handler_key: "partner.webhook", last_success_at: null, dead: 2 });
    expect(processorState([row({ handler_key: "triage.grade" }), partner], false, NOW)).toBe("partner_stuck");
    expect(processorState([row({ handler_key: "triage.grade" }), row({ handler_key: "partner.webhook" })], false, NOW)).toBe("ok");
    expect(processorState([row({ handler_key: "triage.grade" }), row({ handler_key: "partner.webhook", last_success_at: null })], false, NOW)).toBe("ok");
  });
});

describe("parseIdKeys", () => {
  it("accepts id fields and removes duplicates", () => {
    expect(parseIdKeys("lab_result_id, order_ids, lab_result_id")).toEqual({ keys: ["lab_result_id", "order_ids"] });
    expect(parseIdKeys("")).toEqual({ keys: [] });
  });
  it("refuses a person id, a non id field and too many", () => {
    expect(parseIdKeys("patient_id")).toEqual({ error: "invalid" });
    expect(parseIdKeys("lab_result_id, caregiver_id")).toEqual({ error: "invalid" });
    expect(parseIdKeys("result_value")).toEqual({ error: "invalid" });
    expect(parseIdKeys(Array.from({ length: 21 }, (_, i) => `k${i}_id`).join(","))).toEqual({ error: "invalid" });
  });
});

describe("errorWord", () => {
  it("never passes a raw message, only fixed words", () => {
    expect(errorWord("42501")).toBe("forbidden");
    expect(errorWord("55000")).toBe("grace_open");
    expect(errorWord("22023", "reason")).toBe("reason");
    expect(errorWord("22023", "mapping")).toBe("invalid");
    expect(errorWord("XX000")).toBe("generic");
    expect(errorWord(undefined)).toBe("generic");
  });
});
