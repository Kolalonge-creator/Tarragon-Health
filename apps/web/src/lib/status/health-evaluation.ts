import { getProposedConfig } from "@tarragon/shared";

/**
 * SR1: turns the raw measures from public.platform_health_snapshot() into one verdict an external uptime monitor can act
 * on. Pure and dependency-light so every rule is unit-tested. Thresholds come from versioned configuration
 * (ops.health_thresholds, PROPOSED), never from literals here.
 *
 * Verdict: "down" if any check is down, else "degraded" if any is degraded, else "ok". The route answers HTTP 200 for ok
 * and degraded and 503 for down, so a monitor that only watches the status code pages on down and a monitor that reads
 * the body can also warn on degraded.
 */

export type Verdict = "ok" | "degraded" | "down";

export interface HealthThresholds {
  dbQueryTimeoutMs: number;
  connectionsDegradedPercent: number;
  connectionsDownPercent: number;
  overdueTaskDegradedMinutes: number;
  overdueTaskDownMinutes: number;
  unacknowledgedPageDegradedMinutes: number;
  unacknowledgedPageDownMinutes: number;
  notificationBacklogDegradedMinutes: number;
  notificationBacklogDownMinutes: number;
  criticalUnopenedDegradedMinutes: number;
  criticalUnopenedDownMinutes: number;
  eventBacklogDegradedMinutes: number;
  eventBacklogDownMinutes: number;
  webhookBacklogDegradedMinutes: number;
  webhookBacklogDownMinutes: number;
  outboundDeadLetterDegradedCount: number;
}

export interface HealthSnapshot {
  database: { connections_used: number; connections_max: number; size_bytes: number };
  queue: {
    overdue_tasks: number;
    oldest_overdue_task_minutes: number;
    unacknowledged_pages: number;
    oldest_unacknowledged_page_minutes: number;
  };
  notifications: { pending: number; oldest_pending_minutes: number; critical_unopened: number; oldest_critical_unopened_minutes: number };
  events: { due_deliveries: number; oldest_due_delivery_minutes: number };
  webhooks: {
    payments_unprocessed: number;
    oldest_payment_unprocessed_minutes: number;
    zoom_unprocessed: number;
    oldest_zoom_unprocessed_minutes: number;
    outbound_due: number;
    outbound_dead_letter: number;
  };
  cron: {
    jobs_checked: number;
    stale: { job: string; minutes_since_success: number | null; expected_every_minutes: number }[];
    failed_last_hour: number;
  };
}

export interface HealthCheck {
  name: string;
  verdict: Verdict;
  detail: string;
}

export function loadHealthThresholds(): HealthThresholds {
  return getProposedConfig("ops.health_thresholds").value as unknown as HealthThresholds;
}

const RANK: Record<Verdict, number> = { ok: 0, degraded: 1, down: 2 };

export function worst(verdicts: readonly Verdict[]): Verdict {
  return verdicts.reduce<Verdict>((acc, v) => (RANK[v] > RANK[acc] ? v : acc), "ok");
}

function byAge(ageMinutes: number, count: number, degraded: number, down: number): Verdict {
  if (count <= 0) return "ok";
  if (ageMinutes >= down) return "down";
  if (ageMinutes >= degraded) return "degraded";
  return "ok";
}

export function evaluateSnapshot(s: HealthSnapshot, t: HealthThresholds = loadHealthThresholds()): { verdict: Verdict; checks: HealthCheck[] } {
  const checks: HealthCheck[] = [];
  const add = (name: string, verdict: Verdict, detail: string) => checks.push({ name, verdict, detail });

  const connPct = s.database.connections_max > 0 ? (s.database.connections_used / s.database.connections_max) * 100 : 100;
  add(
    "database_connections",
    connPct >= t.connectionsDownPercent ? "down" : connPct >= t.connectionsDegradedPercent ? "degraded" : "ok",
    `${s.database.connections_used} of ${s.database.connections_max} in use (${Math.round(connPct)}%)`,
  );

  add(
    "overdue_clinical_tasks",
    byAge(s.queue.oldest_overdue_task_minutes, s.queue.overdue_tasks, t.overdueTaskDegradedMinutes, t.overdueTaskDownMinutes),
    `${s.queue.overdue_tasks} overdue, oldest ${s.queue.oldest_overdue_task_minutes} min past due`,
  );
  add(
    "unacknowledged_red_pages",
    byAge(s.queue.oldest_unacknowledged_page_minutes, s.queue.unacknowledged_pages, t.unacknowledgedPageDegradedMinutes, t.unacknowledgedPageDownMinutes),
    `${s.queue.unacknowledged_pages} open, oldest ${s.queue.oldest_unacknowledged_page_minutes} min`,
  );
  add(
    "notification_backlog",
    byAge(s.notifications.oldest_pending_minutes, s.notifications.pending, t.notificationBacklogDegradedMinutes, t.notificationBacklogDownMinutes),
    `${s.notifications.pending} pending, oldest ${s.notifications.oldest_pending_minutes} min`,
  );
  add(
    "critical_notifications_unopened",
    byAge(s.notifications.oldest_critical_unopened_minutes, s.notifications.critical_unopened, t.criticalUnopenedDegradedMinutes, t.criticalUnopenedDownMinutes),
    `${s.notifications.critical_unopened} unopened, oldest ${s.notifications.oldest_critical_unopened_minutes} min`,
  );
  add(
    "event_bus_backlog",
    byAge(s.events.oldest_due_delivery_minutes, s.events.due_deliveries, t.eventBacklogDegradedMinutes, t.eventBacklogDownMinutes),
    `${s.events.due_deliveries} due, oldest ${s.events.oldest_due_delivery_minutes} min`,
  );
  add(
    "payment_webhook_backlog",
    byAge(s.webhooks.oldest_payment_unprocessed_minutes, s.webhooks.payments_unprocessed, t.webhookBacklogDegradedMinutes, t.webhookBacklogDownMinutes),
    `${s.webhooks.payments_unprocessed} unprocessed, oldest ${s.webhooks.oldest_payment_unprocessed_minutes} min`,
  );
  add(
    "zoom_webhook_backlog",
    byAge(s.webhooks.oldest_zoom_unprocessed_minutes, s.webhooks.zoom_unprocessed, t.webhookBacklogDegradedMinutes, t.webhookBacklogDownMinutes),
    `${s.webhooks.zoom_unprocessed} unprocessed, oldest ${s.webhooks.oldest_zoom_unprocessed_minutes} min`,
  );
  add(
    "partner_webhook_dead_letters",
    s.webhooks.outbound_dead_letter >= t.outboundDeadLetterDegradedCount ? "degraded" : "ok",
    `${s.webhooks.outbound_dead_letter} dead-lettered, ${s.webhooks.outbound_due} due`,
  );

  // A job that has run before but not within twice its interval is down for the monitor. A job with no success on record
  // at all is only "degraded": on a fresh project or a just-created job there is no history yet.
  const stale = s.cron.stale.filter((j) => j.minutes_since_success !== null);
  const never = s.cron.stale.filter((j) => j.minutes_since_success === null);
  add(
    "cron_freshness",
    stale.length > 0 ? "down" : never.length > 0 ? "degraded" : "ok",
    stale.length > 0
      ? `stale: ${stale.map((j) => `${j.job} (${j.minutes_since_success} min, expected every ${j.expected_every_minutes})`).join(", ")}`
      : never.length > 0
        ? `no success on record yet: ${never.map((j) => j.job).join(", ")}`
        : `${s.cron.jobs_checked} minute-granular jobs fresh`,
  );

  return { verdict: worst(checks.map((c) => c.verdict)), checks };
}
