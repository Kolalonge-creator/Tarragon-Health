import { evaluateSnapshot, loadHealthThresholds, worst, type HealthSnapshot } from "./health-evaluation";
import { isHealthRequestAuthorised, MIN_HEALTH_SECRET_LENGTH } from "./health-auth";

const T = loadHealthThresholds();

function healthy(): HealthSnapshot {
  return {
    database: { connections_used: 17, connections_max: 60, size_bytes: 1 },
    queue: { overdue_tasks: 0, oldest_overdue_task_minutes: 0, unacknowledged_pages: 0, oldest_unacknowledged_page_minutes: 0 },
    notifications: { pending: 0, oldest_pending_minutes: 0, critical_unopened: 0, oldest_critical_unopened_minutes: 0 },
    events: { due_deliveries: 0, oldest_due_delivery_minutes: 0 },
    webhooks: { payments_unprocessed: 0, oldest_payment_unprocessed_minutes: 0, zoom_unprocessed: 0, oldest_zoom_unprocessed_minutes: 0, outbound_due: 0, outbound_dead_letter: 0 },
    cron: { jobs_checked: 30, stale: [], failed_last_hour: 0 },
  };
}

const verdictOf = (s: HealthSnapshot, name: string) => evaluateSnapshot(s, T).checks.find((c) => c.name === name)?.verdict;

describe("evaluateSnapshot", () => {
  it("a healthy snapshot is ok with every check ok", () => {
    const r = evaluateSnapshot(healthy(), T);
    expect(r.verdict).toBe("ok");
    expect(r.checks.every((c) => c.verdict === "ok")).toBe(true);
  });

  it("database connections: degraded at the degraded line, down at the down line", () => {
    const s = healthy();
    s.database = { connections_used: 42, connections_max: 60, size_bytes: 1 }; // 70%
    expect(verdictOf(s, "database_connections")).toBe("degraded");
    s.database = { connections_used: 54, connections_max: 60, size_bytes: 1 }; // 90%
    expect(verdictOf(s, "database_connections")).toBe("down");
  });

  it("an unacknowledged red page is down once it reaches the second step of the paging ladder (10 minutes)", () => {
    const s = healthy();
    s.queue.unacknowledged_pages = 1;
    s.queue.oldest_unacknowledged_page_minutes = T.unacknowledgedPageDegradedMinutes - 1;
    expect(verdictOf(s, "unacknowledged_red_pages")).toBe("ok");
    s.queue.oldest_unacknowledged_page_minutes = T.unacknowledgedPageDegradedMinutes;
    expect(verdictOf(s, "unacknowledged_red_pages")).toBe("degraded");
    s.queue.oldest_unacknowledged_page_minutes = T.unacknowledgedPageDownMinutes;
    expect(evaluateSnapshot(s, T).verdict).toBe("down");
  });

  it("a zero count is ok whatever the age says, so a stale 'oldest' value cannot raise a false alarm", () => {
    const s = healthy();
    s.queue.overdue_tasks = 0;
    s.queue.oldest_overdue_task_minutes = 9999;
    expect(verdictOf(s, "overdue_clinical_tasks")).toBe("ok");
  });

  it.each([
    ["overdue_clinical_tasks", (s: HealthSnapshot, m: number) => ((s.queue.overdue_tasks = 3), (s.queue.oldest_overdue_task_minutes = m)), T.overdueTaskDegradedMinutes, T.overdueTaskDownMinutes],
    ["notification_backlog", (s: HealthSnapshot, m: number) => ((s.notifications.pending = 9), (s.notifications.oldest_pending_minutes = m)), T.notificationBacklogDegradedMinutes, T.notificationBacklogDownMinutes],
    ["critical_notifications_unopened", (s: HealthSnapshot, m: number) => ((s.notifications.critical_unopened = 1), (s.notifications.oldest_critical_unopened_minutes = m)), T.criticalUnopenedDegradedMinutes, T.criticalUnopenedDownMinutes],
    ["event_bus_backlog", (s: HealthSnapshot, m: number) => ((s.events.due_deliveries = 5), (s.events.oldest_due_delivery_minutes = m)), T.eventBacklogDegradedMinutes, T.eventBacklogDownMinutes],
    ["payment_webhook_backlog", (s: HealthSnapshot, m: number) => ((s.webhooks.payments_unprocessed = 1), (s.webhooks.oldest_payment_unprocessed_minutes = m)), T.webhookBacklogDegradedMinutes, T.webhookBacklogDownMinutes],
    ["zoom_webhook_backlog", (s: HealthSnapshot, m: number) => ((s.webhooks.zoom_unprocessed = 1), (s.webhooks.oldest_zoom_unprocessed_minutes = m)), T.webhookBacklogDegradedMinutes, T.webhookBacklogDownMinutes],
  ])("%s goes ok, degraded, down as the oldest item ages", (name, set, degraded, down) => {
    const ok = healthy();
    set(ok, degraded - 1);
    const warn = healthy();
    set(warn, degraded);
    const bad = healthy();
    set(bad, down);
    expect([verdictOf(ok, name), verdictOf(warn, name), verdictOf(bad, name)]).toEqual(["ok", "degraded", "down"]);
  });

  it("a dead-lettered partner webhook degrades the verdict but does not page", () => {
    const s = healthy();
    s.webhooks.outbound_dead_letter = 1;
    expect(evaluateSnapshot(s, T).verdict).toBe("degraded");
  });

  it("a stale cron job that has succeeded before is down; one with no success on record is only degraded", () => {
    const stale = healthy();
    stale.cron.stale = [{ job: "sweep-clinical-tasks", minutes_since_success: 12, expected_every_minutes: 1 }];
    expect(verdictOf(stale, "cron_freshness")).toBe("down");
    const fresh = healthy();
    fresh.cron.stale = [{ job: "new-job", minutes_since_success: null, expected_every_minutes: 5 }];
    expect(verdictOf(fresh, "cron_freshness")).toBe("degraded");
  });

  it("the overall verdict is the worst check", () => {
    expect(worst([])).toBe("ok");
    expect(worst(["ok", "degraded", "ok"])).toBe("degraded");
    expect(worst(["degraded", "down", "ok"])).toBe("down");
  });

  it("thresholds are read from versioned config, not hard-coded", () => {
    expect(T.unacknowledgedPageDownMinutes).toBe(10);
    expect(T.connectionsDegradedPercent).toBe(70);
  });
});

describe("isHealthRequestAuthorised", () => {
  const SECRET = "s".repeat(MIN_HEALTH_SECRET_LENGTH);
  const h = (init: Record<string, string>) => new Headers(init);

  it("fails closed when the secret is unset or too short", () => {
    expect(isHealthRequestAuthorised(h({ "x-health-secret": SECRET }), undefined)).toBe("not_configured");
    expect(isHealthRequestAuthorised(h({ "x-health-secret": "short" }), "short")).toBe("not_configured");
  });

  it("accepts the secret in the header or as a bearer token", () => {
    expect(isHealthRequestAuthorised(h({ "x-health-secret": SECRET }), SECRET)).toBe("ok");
    expect(isHealthRequestAuthorised(h({ authorization: `Bearer ${SECRET}` }), SECRET)).toBe("ok");
  });

  it("denies a wrong, missing or differently-sized secret", () => {
    expect(isHealthRequestAuthorised(h({ "x-health-secret": "x".repeat(MIN_HEALTH_SECRET_LENGTH) }), SECRET)).toBe("denied");
    expect(isHealthRequestAuthorised(h({}), SECRET)).toBe("denied");
    expect(isHealthRequestAuthorised(h({ "x-health-secret": SECRET + "x" }), SECRET)).toBe("denied");
  });
});
