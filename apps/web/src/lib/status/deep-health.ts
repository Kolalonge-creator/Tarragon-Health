import { z } from "zod";
import type { HealthCheck, Verdict } from "./health-evaluation";
import { worst } from "./health-evaluation";

/**
 * OQ-452: the heartbeat half of /api/health/deep. Pure so every rule is unit-tested.
 *
 * public.platform_deep_health() (service role only) returns raw ages and limits for the queue jobs (queue_job_heartbeats) and the paging
 * engine (paging_heartbeats, which includes process_events: the edge function's own heartbeat) plus the count of open sev1 incidents. The
 * chain canary answer comes from public.canary_heartbeat(). Each becomes one check. A heartbeat with NO row, a limit that cannot be read
 * or an answer in the wrong shape is a FAILING check, never a pass: the monitor must treat "cannot tell" as down.
 *
 * The public response carries check names and ok/down only (see publicChecks): never an age, a count, a job's last result or an id.
 */

const ageSchema = z.number().int().nullable();
export const deepHealthFactsSchema = z.object({
  queue_jobs: z.array(z.object({ job: z.string().min(1), age_seconds: ageSchema, max_age_seconds: z.number().int().positive() })),
  paging: z.array(z.object({ component: z.string().min(1), age_seconds: ageSchema, max_age_seconds: z.number().int().positive() })),
  open_sev1: z.number().int().min(0),
});
export type DeepHealthFacts = z.infer<typeof deepHealthFactsSchema>;

export const canarySchema = z.object({ ok: z.boolean(), age_bucket: z.string() });
export type CanaryAnswer = z.infer<typeof canarySchema>;

/** The jobs and components the monitor requires to exist. A missing one is a fault, whatever the database said. */
export const REQUIRED_QUEUE_JOBS = ["sweep-clinical-tasks", "expire-task-claims", "queue-watchdog"] as const;
export const REQUIRED_PAGING_COMPONENTS = ["sweep_pages", "process_events", "reconciler"] as const;

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "_").toLowerCase();

function ageCheck(name: string, row: { age_seconds: number | null; max_age_seconds: number } | undefined): HealthCheck {
  if (!row || row.age_seconds === null) return { name, verdict: "down", detail: "no heartbeat on record" };
  return row.age_seconds > row.max_age_seconds
    ? { name, verdict: "down", detail: "heartbeat stale" }
    : { name, verdict: "ok", detail: "fresh" };
}

/** Facts null = the read failed or came back in the wrong shape. */
export function evaluateDeepHealth(facts: DeepHealthFacts | null, canary: CanaryAnswer | null): { verdict: Verdict; checks: HealthCheck[] } {
  const checks: HealthCheck[] = [];
  if (!facts) {
    checks.push({ name: "deep_health_unreadable", verdict: "down", detail: "heartbeats could not be read" });
  } else {
    for (const job of REQUIRED_QUEUE_JOBS) checks.push(ageCheck(`heartbeat_queue_${slug(job)}`, facts.queue_jobs.find((r) => r.job === job)));
    for (const component of REQUIRED_PAGING_COMPONENTS) checks.push(ageCheck(`heartbeat_paging_${slug(component)}`, facts.paging.find((r) => r.component === component)));
    checks.push(facts.open_sev1 > 0 ? { name: "open_sev1_incident", verdict: "down", detail: "a sev1 incident is open" } : { name: "open_sev1_incident", verdict: "ok", detail: "none open" });
  }
  checks.push(canary === null ? { name: "chain_canary", verdict: "down", detail: "canary could not be read" } : canary.ok ? { name: "chain_canary", verdict: "ok", detail: "running" } : { name: "chain_canary", verdict: "down", detail: "canary quiet" });
  return { verdict: worst(checks.map((c) => c.verdict)), checks };
}

/** What may leave the building: a name and a verdict. The detail strings above are for tests and logs only. */
export function publicChecks(checks: readonly HealthCheck[]): { name: string; verdict: Verdict }[] {
  return checks.map((c) => ({ name: c.name, verdict: c.verdict }));
}

export function failingNames(checks: readonly HealthCheck[]): string[] {
  return checks.filter((c) => c.verdict !== "ok").map((c) => c.name);
}
