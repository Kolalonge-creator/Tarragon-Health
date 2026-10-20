import { describe, expect, it } from "@jest/globals";
import { evaluateDeepHealth, failingNames, publicChecks, type CanaryAnswer, type DeepHealthFacts } from "./deep-health";

const fresh = (): DeepHealthFacts => ({
  queue_jobs: [
    { job: "sweep-clinical-tasks", age_seconds: 40, max_age_seconds: 300 },
    { job: "expire-task-claims", age_seconds: 40, max_age_seconds: 300 },
    { job: "queue-watchdog", age_seconds: 400, max_age_seconds: 1500 },
  ],
  paging: [
    { component: "sweep_pages", age_seconds: 30, max_age_seconds: 120 },
    { component: "process_events", age_seconds: 30, max_age_seconds: 120 },
    { component: "reconciler", age_seconds: 30, max_age_seconds: 120 },
  ],
  open_sev1: 0,
});
const canaryOk: CanaryAnswer = { ok: true, age_bucket: "under_1h" };
const verdict = (facts: DeepHealthFacts | null, canary: CanaryAnswer | null, name: string) =>
  evaluateDeepHealth(facts, canary).checks.find((c) => c.name === name)?.verdict;

describe("evaluateDeepHealth", () => {
  it("everything fresh, no sev1 and a running canary is ok", () => {
    const r = evaluateDeepHealth(fresh(), canaryOk);
    expect(r.verdict).toBe("ok");
    expect(r.checks.map((c) => c.name)).toEqual([
      "heartbeat_queue_sweep_clinical_tasks", "heartbeat_queue_expire_task_claims", "heartbeat_queue_queue_watchdog",
      "heartbeat_paging_sweep_pages", "heartbeat_paging_process_events", "heartbeat_paging_reconciler", "open_sev1_incident", "chain_canary",
    ]);
  });

  it.each([
    ["sweep-clinical-tasks", "heartbeat_queue_sweep_clinical_tasks"],
    ["expire-task-claims", "heartbeat_queue_expire_task_claims"],
    ["queue-watchdog", "heartbeat_queue_queue_watchdog"],
  ])("a stale queue job (%s) is down", (job, name) => {
    const f = fresh();
    const row = f.queue_jobs.find((r) => r.job === job);
    if (!row) throw new Error("fixture");
    row.age_seconds = row.max_age_seconds + 1;
    expect(verdict(f, canaryOk, name)).toBe("down");
  });

  it("a heartbeat exactly at its limit is still fresh; one second over is down", () => {
    const f = fresh();
    f.paging[1] = { component: "process_events", age_seconds: 120, max_age_seconds: 120 };
    expect(verdict(f, canaryOk, "heartbeat_paging_process_events")).toBe("ok");
    f.paging[1] = { component: "process_events", age_seconds: 121, max_age_seconds: 120 };
    expect(verdict(f, canaryOk, "heartbeat_paging_process_events")).toBe("down");
  });

  it("a stale process_events heartbeat (the edge function) is down", () => {
    const f = fresh();
    f.paging[1].age_seconds = 9999;
    expect(evaluateDeepHealth(f, canaryOk).verdict).toBe("down");
  });

  it("a heartbeat that has no row at all, or a job the database did not list, is down and never a pass", () => {
    const f = fresh();
    f.paging[2].age_seconds = null;
    expect(verdict(f, canaryOk, "heartbeat_paging_reconciler")).toBe("down");
    f.queue_jobs = f.queue_jobs.filter((r) => r.job !== "expire-task-claims");
    expect(verdict(f, canaryOk, "heartbeat_queue_expire_task_claims")).toBe("down");
  });

  it("any open sev1 incident fails the check", () => {
    const f = fresh();
    f.open_sev1 = 1;
    expect(verdict(f, canaryOk, "open_sev1_incident")).toBe("down");
  });

  it("a quiet or unreadable canary fails; an unreadable heartbeat read fails as a whole", () => {
    expect(verdict(fresh(), { ok: false, age_bucket: "over_24h" }, "chain_canary")).toBe("down");
    expect(verdict(fresh(), null, "chain_canary")).toBe("down");
    const r = evaluateDeepHealth(null, canaryOk);
    expect(r.verdict).toBe("down");
    expect(r.checks.map((c) => c.name)).toContain("deep_health_unreadable");
  });
});

describe("what may leave the building", () => {
  it("publicChecks carries a name and a verdict only, and failingNames lists the non-ok names", () => {
    const f = fresh();
    f.open_sev1 = 3;
    f.paging[0].age_seconds = 5000;
    const { checks } = evaluateDeepHealth(f, canaryOk);
    for (const c of publicChecks(checks)) expect(Object.keys(c).sort()).toEqual(["name", "verdict"]);
    expect(failingNames(checks)).toEqual(["heartbeat_paging_sweep_pages", "open_sev1_incident"]);
    expect(JSON.stringify(publicChecks(checks))).not.toMatch(/5000|\b3\b/);
  });
});
