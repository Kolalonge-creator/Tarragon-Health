import { evaluateDeadman, loadDeadmanThresholds, parseDeadmanStatus, type DeadmanStatus } from "./deadman-evaluation";

const T = loadDeadmanThresholds();
const ok = (): DeadmanStatus => ({
  process_events_heartbeat_age_seconds: 10,
  due_unclaimed_deliveries: 0,
  dead_letter_deliveries: 0,
  open_sev1_sev2_incidents: 0,
  stale_critical_cron_jobs: 0,
  failing_critical_cron_jobs: 0,
  missing_critical_cron_jobs: 0,
  critical_cron_job_problems: { stale: [], failing: [], missing: [] },
});
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

describe("safety sweeper checks (heartbeats for the pg_cron sweepers)", () => {
  it("one silent safety sweeper is down: it opens the incident issue, because it looks like 'no red events'", () => {
    const s = { ...ok(), stale_critical_cron_jobs: 1, critical_cron_job_problems: { stale: ["sweep-pages"], failing: [], missing: [] } };
    const r = evaluateDeadman(s, T);
    expect(r.verdict).toBe("down");
    expect(r.checks.find((c) => c.name === "stale_critical_cron_jobs")?.detail).toContain("sweep-pages");
  });
  it("one failed run is a warning, two failing sweepers are down", () => {
    expect(v({ ...ok(), failing_critical_cron_jobs: 1 }, "failing_critical_cron_jobs")).toBe("degraded");
    expect(v({ ...ok(), failing_critical_cron_jobs: 2 }, "failing_critical_cron_jobs")).toBe("down");
  });
  it("a listed job with no cron job is never down, whatever the count (a configuration fault, not an outage)", () => {
    expect(v({ ...ok(), missing_critical_cron_jobs: 1 }, "missing_critical_cron_jobs")).toBe("degraded");
    expect(v({ ...ok(), missing_critical_cron_jobs: 11 }, "missing_critical_cron_jobs")).toBe("degraded");
    expect(evaluateDeadman({ ...ok(), missing_critical_cron_jobs: 11 }, T).verdict).toBe("degraded");
  });
  it("healthy sweepers add nothing: ok stays ok", () => {
    expect(v(ok(), "stale_critical_cron_jobs")).toBe("ok");
    expect(v(ok(), "failing_critical_cron_jobs")).toBe("ok");
    expect(v(ok(), "missing_critical_cron_jobs")).toBe("ok");
  });
  it("the v2 thresholds are the ones loaded", () => {
    expect(T.staleCriticalJobsDownCount).toBe(1);
    expect(T.failingCriticalJobsDownCount).toBe(2);
  });
});

describe("parseDeadmanStatus", () => {
  it("reads the sweeper counts and names, and keeps only strings from the lists", () => {
    const parsed = parseDeadmanStatus({
      process_events_heartbeat_age_seconds: 3,
      due_unclaimed_deliveries: 0,
      dead_letter_deliveries: 0,
      open_sev1_sev2_incidents: 0,
      stale_critical_cron_jobs: "2",
      failing_critical_cron_jobs: 1,
      missing_critical_cron_jobs: 0,
      critical_cron_job_problems: { stale: ["a", 5, "b"], failing: ["c"], missing: "x" },
    });
    expect(parsed).toMatchObject({ stale_critical_cron_jobs: 2, failing_critical_cron_jobs: 1, critical_cron_job_problems: { stale: ["a", "b"], failing: ["c"], missing: [] } });
  });
  it("a database without the migration (no sweeper keys) reads as zeros, so the app can ship first", () => {
    const parsed = parseDeadmanStatus({ process_events_heartbeat_age_seconds: 3, due_unclaimed_deliveries: 0, dead_letter_deliveries: 0, open_sev1_sev2_incidents: 0 });
    expect(parsed).toMatchObject({ stale_critical_cron_jobs: 0, failing_critical_cron_jobs: 0, missing_critical_cron_jobs: 0 });
  });
  it("a present but malformed sweeper count is refused, never read as 0", () => {
    expect(parseDeadmanStatus({ process_events_heartbeat_age_seconds: 3, due_unclaimed_deliveries: 0, dead_letter_deliveries: 0, open_sev1_sev2_incidents: 0, stale_critical_cron_jobs: "lots" })).toBeNull();
    expect(parseDeadmanStatus({ process_events_heartbeat_age_seconds: 3, due_unclaimed_deliveries: 0, dead_letter_deliveries: 0, open_sev1_sev2_incidents: 0, failing_critical_cron_jobs: -1 })).toBeNull();
  });
  it("accepts a good payload including a null heartbeat and string counts (bigint)", () => {
    expect(parseDeadmanStatus({ process_events_heartbeat_age_seconds: null, due_unclaimed_deliveries: "2", dead_letter_deliveries: 0, open_sev1_sev2_incidents: 1 })).toEqual({
      process_events_heartbeat_age_seconds: null,
      due_unclaimed_deliveries: 2,
      dead_letter_deliveries: 0,
      open_sev1_sev2_incidents: 1,
      stale_critical_cron_jobs: 0,
      failing_critical_cron_jobs: 0,
      missing_critical_cron_jobs: 0,
      critical_cron_job_problems: { stale: [], failing: [], missing: [] },
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
