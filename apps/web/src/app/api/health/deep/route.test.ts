import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

type Answer = { data: unknown; error: unknown };
const answers: Record<string, Answer | "throw"> = {};
const rpc = jest.fn((name: string): Promise<Answer> => {
  const a = answers[name];
  if (a === "throw") return Promise.reject(new Error("connection refused: postgres://user:pw@host"));
  return Promise.resolve(a ?? { data: null, error: new Error("no answer") });
});
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: (n: string) => rpc(n) }) }));

import { GET } from "./route";

const SECRET = "s".repeat(32);
const req = (headers: Record<string, string> = {}) => new Request("https://app.example/api/health/deep", { headers });

const snapshot = {
  database: { connections_used: 10, connections_max: 60, size_bytes: 1 },
  queue: { overdue_tasks: 0, oldest_overdue_task_minutes: 0, unacknowledged_pages: 0, oldest_unacknowledged_page_minutes: 0 },
  notifications: { pending: 0, oldest_pending_minutes: 0, critical_unopened: 0, oldest_critical_unopened_minutes: 0 },
  events: { due_deliveries: 0, oldest_due_delivery_minutes: 0 },
  webhooks: { payments_unprocessed: 0, oldest_payment_unprocessed_minutes: 0, zoom_unprocessed: 0, oldest_zoom_unprocessed_minutes: 0, outbound_due: 0, outbound_dead_letter: 0 },
  cron: { jobs_checked: 5, stale: [], failed_last_hour: 0 },
};
const deep = () => ({
  queue_jobs: [
    { job: "sweep-clinical-tasks", age_seconds: 10, max_age_seconds: 300 },
    { job: "expire-task-claims", age_seconds: 10, max_age_seconds: 300 },
    { job: "queue-watchdog", age_seconds: 10, max_age_seconds: 1500 },
  ],
  paging: [
    { component: "sweep_pages", age_seconds: 10, max_age_seconds: 120 },
    { component: "process_events", age_seconds: 10, max_age_seconds: 120 },
    { component: "reconciler", age_seconds: 10, max_age_seconds: 120 },
  ],
  open_sev1: 0,
});

function healthy() {
  answers.platform_health_snapshot = { data: snapshot, error: null };
  answers.platform_deep_health = { data: deep(), error: null };
  answers.canary_heartbeat = { data: { ok: true, age_bucket: "under_1h" }, error: null };
}

const original = process.env.HEALTH_CHECK_SECRET;
beforeEach(() => {
  rpc.mockClear();
  for (const k of Object.keys(answers)) delete answers[k];
  process.env.HEALTH_CHECK_SECRET = SECRET;
  healthy();
});
afterEach(() => {
  if (original === undefined) delete process.env.HEALTH_CHECK_SECRET;
  else process.env.HEALTH_CHECK_SECRET = original;
});

describe("GET /api/health/deep: authentication", () => {
  it("503 and reads nothing when the secret is not configured, even if a header is sent", async () => {
    delete process.env.HEALTH_CHECK_SECRET;
    const res = await GET(req({ "x-health-secret": SECRET }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "not configured" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("503 and reads nothing when the configured secret is too short to be a secret", async () => {
    process.env.HEALTH_CHECK_SECRET = "short";
    expect((await GET(req({ "x-health-secret": "short" }))).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("401 with no header and with a wrong secret, and reads nothing", async () => {
    expect((await GET(req())).status).toBe(401);
    const res = await GET(req({ "x-health-secret": "x".repeat(32) }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "unauthorised" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts the secret as a bearer token as well", async () => {
    expect((await GET(req({ authorization: `Bearer ${SECRET}` }))).status).toBe(200);
  });
});

describe("GET /api/health/deep: verdicts", () => {
  it("200 only when every check is ok, with no-store", async () => {
    const res = await GET(req({ "x-health-secret": SECRET }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, verdict: "ok", failing: [] });
    expect(rpc).toHaveBeenCalledWith("platform_deep_health");
  });

  it("503 with the failing check name when a pager heartbeat is stale", async () => {
    const d = deep();
    d.paging[1].age_seconds = 3600;
    answers.platform_deep_health = { data: d, error: null };
    const res = await GET(req({ "x-health-secret": SECRET }));
    expect(res.status).toBe(503);
    expect((await res.json()).failing).toEqual(["heartbeat_paging_process_events"]);
  });

  it("503 for a stale queue heartbeat, an open sev1 and a quiet canary, each by name", async () => {
    const d = deep();
    d.queue_jobs[0].age_seconds = 9999;
    d.open_sev1 = 2;
    answers.platform_deep_health = { data: d, error: null };
    answers.canary_heartbeat = { data: { ok: false, age_bucket: "over_24h" }, error: null };
    const res = await GET(req({ "x-health-secret": SECRET }));
    expect(res.status).toBe(503);
    expect((await res.json()).failing).toEqual(["heartbeat_queue_sweep_clinical_tasks", "open_sev1_incident", "chain_canary"]);
  });

  it("503 when the snapshot is merely degraded: 200 means healthy and nothing else", async () => {
    answers.platform_health_snapshot = { data: { ...snapshot, queue: { ...snapshot.queue, unacknowledged_pages: 1, oldest_unacknowledged_page_minutes: 5 } }, error: null };
    const res = await GET(req({ "x-health-secret": SECRET }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.verdict).toBe("degraded");
    expect(body.failing).toEqual(["unacknowledged_red_pages"]);
  });

  it("503 when the heartbeat function is missing or malformed, never a pass", async () => {
    answers.platform_deep_health = { data: null, error: { message: "function does not exist" } };
    let res = await GET(req({ "x-health-secret": SECRET }));
    expect(res.status).toBe(503);
    expect((await res.json()).failing).toEqual(["deep_health_unreadable"]);
    answers.platform_deep_health = { data: { queue_jobs: "x" }, error: null };
    res = await GET(req({ "x-health-secret": SECRET }));
    expect(res.status).toBe(503);
  });

  it("503 database_unreachable when the snapshot errors or the connection throws, without leaking the error", async () => {
    answers.platform_health_snapshot = { data: null, error: { message: "password authentication failed for user postgres" } };
    let res = await GET(req({ "x-health-secret": SECRET }));
    expect(res.status).toBe(503);
    expect((await res.json()).failing).toEqual(["database_unreachable"]);
    answers.platform_health_snapshot = "throw";
    res = await GET(req({ "x-health-secret": SECRET }));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/postgres|password|connection/i);
  });

  it("never puts an age, a count, a detail string or an error text in the body", async () => {
    const d = deep();
    d.paging[0].age_seconds = 7777;
    d.open_sev1 = 4;
    answers.platform_deep_health = { data: d, error: null };
    const text = JSON.stringify(await (await GET(req({ "x-health-secret": SECRET }))).json());
    expect(text).not.toMatch(/7777|detail|age_seconds|open_sev1"/);
    expect(text).not.toContain("heartbeat stale");
  });
});
