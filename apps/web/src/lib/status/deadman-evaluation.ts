import { getProposedConfig } from "@tarragon/shared";
import { worst, type Verdict } from "./health-evaluation";

/**
 * OQ-436: turns the four numbers from public.deadman_status() into one verdict for the external dead-man's switch.
 * Pure, so every rule is unit-tested. Thresholds come from versioned configuration (ops.deadman_thresholds, PROPOSED).
 * A heartbeat that was never recorded (null) is "down": cannot tell is never ok.
 */
export interface DeadmanThresholds {
  dbQueryTimeoutMs: number;
  heartbeatDegradedSeconds: number;
  heartbeatDownSeconds: number;
  dueOlderThanSeconds: number;
  dueUnclaimedDegradedCount: number;
  dueUnclaimedDownCount: number;
  deadLetterDegradedCount: number;
  deadLetterDownCount: number;
  openSev1Sev2DegradedCount: number;
  openSev1Sev2DownCount: number;
  /** Safety sweepers (pg_cron) that stopped running, newest run failed, or have no active job. v2 of the config. */
  staleCriticalJobsDegradedCount: number;
  staleCriticalJobsDownCount: number;
  failingCriticalJobsDegradedCount: number;
  failingCriticalJobsDownCount: number;
  missingCriticalJobsDegradedCount: number;
}

export interface CriticalJobProblems {
  stale: string[];
  failing: string[];
  missing: string[];
}

export interface DeadmanStatus {
  process_events_heartbeat_age_seconds: number | null;
  due_unclaimed_deliveries: number;
  dead_letter_deliveries: number;
  open_sev1_sev2_incidents: number;
  /**
   * The sweeper counts come from the migration 20261027083719. A database that does not have it yet returns none of them, which is
   * read as 0 so the app can be deployed first; the three problem lists are job names only (no patient or staff data).
   */
  stale_critical_cron_jobs: number;
  failing_critical_cron_jobs: number;
  missing_critical_cron_jobs: number;
  critical_cron_job_problems: CriticalJobProblems;
}

export interface DeadmanCheck {
  name: string;
  verdict: Verdict;
  detail: string;
}

export function loadDeadmanThresholds(): DeadmanThresholds {
  return getProposedConfig("ops.deadman_thresholds").value as unknown as DeadmanThresholds;
}

function byCount(n: number, degraded: number, down: number): Verdict {
  return n >= down ? "down" : n >= degraded ? "degraded" : "ok";
}

function nonNegative(v: unknown): number | null {
  const n = typeof v === "string" ? (v.trim() === "" ? Number.NaN : Number(v)) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

/** Narrows an untyped RPC payload; anything malformed returns null so the caller reports "down", never ok. */
export function parseDeadmanStatus(raw: unknown): DeadmanStatus | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const hbRaw = r.process_events_heartbeat_age_seconds;
  const heartbeat = hbRaw === null || hbRaw === undefined ? null : nonNegative(hbRaw);
  if (hbRaw !== null && hbRaw !== undefined && heartbeat === null) return null;
  const due = nonNegative(r.due_unclaimed_deliveries);
  const dead = nonNegative(r.dead_letter_deliveries);
  const inc = nonNegative(r.open_sev1_sev2_incidents);
  if (due === null || dead === null || inc === null) return null;
  // Absent (older database) is 0; present but malformed is a refusal, never a silent 0.
  const optionalCount = (v: unknown): number | null => (v === undefined || v === null ? 0 : nonNegative(v));
  const stale = optionalCount(r.stale_critical_cron_jobs);
  const failing = optionalCount(r.failing_critical_cron_jobs);
  const missing = optionalCount(r.missing_critical_cron_jobs);
  if (stale === null || failing === null || missing === null) return null;
  return {
    process_events_heartbeat_age_seconds: heartbeat,
    due_unclaimed_deliveries: due,
    dead_letter_deliveries: dead,
    open_sev1_sev2_incidents: inc,
    stale_critical_cron_jobs: stale,
    failing_critical_cron_jobs: failing,
    missing_critical_cron_jobs: missing,
    critical_cron_job_problems: parseProblems(r.critical_cron_job_problems),
  };
}

function names(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 20) : [];
}

function parseProblems(raw: unknown): CriticalJobProblems {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return { stale: names(o.stale), failing: names(o.failing), missing: names(o.missing) };
}

function listOrNone(label: string, list: string[], count: number): string {
  if (count === 0) return "none";
  return list.length > 0 ? `${label}: ${list.join(", ")}` : `${count}`;
}

export function evaluateDeadman(s: DeadmanStatus, t: DeadmanThresholds = loadDeadmanThresholds()): { verdict: Verdict; checks: DeadmanCheck[] } {
  const hb = s.process_events_heartbeat_age_seconds;
  const checks: DeadmanCheck[] = [
    {
      name: "process_events_heartbeat",
      verdict: hb === null ? "down" : hb >= t.heartbeatDownSeconds ? "down" : hb >= t.heartbeatDegradedSeconds ? "degraded" : "ok",
      detail: hb === null ? "no heartbeat has ever been recorded" : `last heartbeat ${hb} seconds ago`,
    },
    {
      name: "due_unclaimed_deliveries",
      verdict: byCount(s.due_unclaimed_deliveries, t.dueUnclaimedDegradedCount, t.dueUnclaimedDownCount),
      detail: `${s.due_unclaimed_deliveries} due for more than ${t.dueOlderThanSeconds} seconds and not claimed`,
    },
    {
      name: "dead_letter_deliveries",
      verdict: byCount(s.dead_letter_deliveries, t.deadLetterDegradedCount, t.deadLetterDownCount),
      detail: `${s.dead_letter_deliveries} dead-lettered`,
    },
    {
      name: "open_sev1_sev2_incidents",
      verdict: byCount(s.open_sev1_sev2_incidents, t.openSev1Sev2DegradedCount, t.openSev1Sev2DownCount),
      detail: `${s.open_sev1_sev2_incidents} open`,
    },
    {
      name: "stale_critical_cron_jobs",
      verdict: byCount(s.stale_critical_cron_jobs, t.staleCriticalJobsDegradedCount, t.staleCriticalJobsDownCount),
      detail: `safety sweepers silent past their allowance: ${listOrNone("stale", s.critical_cron_job_problems.stale, s.stale_critical_cron_jobs)}`,
    },
    {
      name: "failing_critical_cron_jobs",
      verdict: byCount(s.failing_critical_cron_jobs, t.failingCriticalJobsDegradedCount, t.failingCriticalJobsDownCount),
      detail: `safety sweepers whose newest run failed: ${listOrNone("failing", s.critical_cron_job_problems.failing, s.failing_critical_cron_jobs)}`,
    },
    {
      // Never "down": a wrong or renamed job name in the allow-list is a configuration fault, and paging on it would teach people to ignore the alert.
      name: "missing_critical_cron_jobs",
      verdict: s.missing_critical_cron_jobs >= t.missingCriticalJobsDegradedCount ? "degraded" : "ok",
      detail: `listed safety sweepers with no active cron job: ${listOrNone("missing", s.critical_cron_job_problems.missing, s.missing_critical_cron_jobs)}`,
    },
  ];
  const verdict = worst(checks.map((c) => c.verdict));
  return { verdict, checks };
}
