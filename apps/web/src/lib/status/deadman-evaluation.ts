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
}

export interface DeadmanStatus {
  process_events_heartbeat_age_seconds: number | null;
  due_unclaimed_deliveries: number;
  dead_letter_deliveries: number;
  open_sev1_sev2_incidents: number;
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
  return { process_events_heartbeat_age_seconds: heartbeat, due_unclaimed_deliveries: due, dead_letter_deliveries: dead, open_sev1_sev2_incidents: inc };
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
  ];
  const verdict = worst(checks.map((c) => c.verdict));
  return { verdict, checks };
}
