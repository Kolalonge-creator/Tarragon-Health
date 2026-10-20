import { evaluateDeadman, loadDeadmanThresholds, parseDeadmanStatus, type DeadmanStatus } from "./deadman-evaluation";

const T = loadDeadmanThresholds();
const ok = (): DeadmanStatus => ({ process_events_heartbeat_age_seconds: 10, due_unclaimed_deliveries: 0, dead_letter_deliveries: 0, open_sev1_sev2_incidents: 0 });
const v = (s: DeadmanStatus, name: string) => evaluateDeadman(s, T).checks.find((c) => c.name === name)?.verdict;

describe("evaluateDeadman", () => {
  it("healthy is ok", () => expect(evaluateDeadman(ok(), T).verdict).toBe("ok"));
  it("heartbeat: ok just under, degraded at the line, down at the down line", () => {
    expect(v({ ...ok(), process_events_heartbeat_age_seconds: T.heartbeatDegradedSeconds - 1 }, "process_events_heartbeat")).toBe("ok");
    expect(v({ ...ok(), process_events_heartbeat_age_seconds: T.heartbeatDegradedSeconds }, "process_events_heartbeat")).toBe("degraded");
    expect(v({ ...ok(), process_events_heartbeat_age_seconds: T.heartbeatDownSeconds }, "process_events_heartbeat")).toBe("down");
  });
  it("a heartbeat never recorded is down, never ok", () => {
    expect(evaluateDeadman({ ...ok(), process_events_heartbeat_age_seconds: null }, T).verdict).toBe("down");
  });
  it("due-unclaimed, dead-letter and incident counts follow their thresholds", () => {
    expect(v({ ...ok(), due_unclaimed_deliveries: 0 }, "due_unclaimed_deliveries")).toBe("ok");
    expect(v({ ...ok(), due_unclaimed_deliveries: T.dueUnclaimedDegradedCount }, "due_unclaimed_deliveries")).toBe("degraded");
    expect(v({ ...ok(), due_unclaimed_deliveries: T.dueUnclaimedDownCount }, "due_unclaimed_deliveries")).toBe("down");
    expect(v({ ...ok(), dead_letter_deliveries: T.deadLetterDegradedCount }, "dead_letter_deliveries")).toBe("degraded");
    expect(v({ ...ok(), dead_letter_deliveries: T.deadLetterDownCount }, "dead_letter_deliveries")).toBe("down");
    expect(v({ ...ok(), open_sev1_sev2_incidents: T.openSev1Sev2DegradedCount }, "open_sev1_sev2_incidents")).toBe("degraded");
    expect(v({ ...ok(), open_sev1_sev2_incidents: T.openSev1Sev2DownCount }, "open_sev1_sev2_incidents")).toBe("down");
  });
  it("the overall verdict is the worst check", () => {
    expect(evaluateDeadman({ ...ok(), dead_letter_deliveries: 1 }, T).verdict).toBe("degraded");
    expect(evaluateDeadman({ ...ok(), dead_letter_deliveries: 1, process_events_heartbeat_age_seconds: 9999 }, T).verdict).toBe("down");
  });
});

describe("parseDeadmanStatus", () => {
  it("accepts a good payload including a null heartbeat and string counts (bigint)", () => {
    expect(parseDeadmanStatus({ process_events_heartbeat_age_seconds: null, due_unclaimed_deliveries: "2", dead_letter_deliveries: 0, open_sev1_sev2_incidents: 1 })).toEqual({
      process_events_heartbeat_age_seconds: null,
      due_unclaimed_deliveries: 2,
      dead_letter_deliveries: 0,
      open_sev1_sev2_incidents: 1,
    });
  });
  it("rejects malformed payloads", () => {
    const bad = [
      null,
      "x",
      {},
      { process_events_heartbeat_age_seconds: "abc", due_unclaimed_deliveries: 0, dead_letter_deliveries: 0, open_sev1_sev2_incidents: 0 },
      { process_events_heartbeat_age_seconds: "  ", due_unclaimed_deliveries: 0, dead_letter_deliveries: 0, open_sev1_sev2_incidents: 0 },
      { process_events_heartbeat_age_seconds: 1, due_unclaimed_deliveries: -1, dead_letter_deliveries: 0, open_sev1_sev2_incidents: 0 },
    ];
    for (const b of bad) expect(parseDeadmanStatus(b)).toBeNull();
  });
});
