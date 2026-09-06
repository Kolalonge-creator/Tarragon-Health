import type { EscalationLevel } from "@tarragon/shared";

// Order matches docs spec §89.16's ladder: Emergency > Specialist >
// Significant(doctor) > Concern(clinician) > Normal(routine).
const LEVEL_PRIORITY: Record<EscalationLevel, number> = {
  emergency: 0,
  specialist_review: 1,
  urgent_escalation: 2,
  clinician_review: 3,
  routine: 4,
};

/**
 * Rank of a single level, lowest number = most severe. Exposed so a queue
 * that ranks rows carrying a level but no SLA (the results inbox) can reuse
 * exactly this ladder instead of inventing a second, drifting one.
 */
export function levelRank(level: EscalationLevel): number {
  return LEVEL_PRIORITY[level];
}

/**
 * The level a worklist should actually triage/rank by. A clinician's
 * recorded disagreement (clinician_alerts.override_level, see the
 * clinician_override migration) always wins over the system's own
 * deterministic classification — `level` itself is never touched, so this
 * is the one place that reconciles the two into a single effective value.
 */
export function effectiveAlertLevel(alert: {
  level: EscalationLevel;
  override_level?: EscalationLevel | null;
}): EscalationLevel {
  return alert.override_level ?? alert.level;
}

/**
 * Whether an alert engages the Tier 2+ authority gate on claiming/resolving
 * an escalation (private.enforce_emergency_escalation_tier,
 * 20260731021500_emergency_escalation_tier_gate.sql).
 *
 * Deliberately NOT effectiveAlertLevel(alert) === "emergency". The gate
 * fires when EITHER the system's own classification OR a clinician's
 * override is 'emergency', because a Tier 1 holds an active clinical_staff
 * row and can therefore override an emergency down to routine -- coalesce
 * alone would let them hand themselves the case. Mirrors the DB predicate
 * exactly; keep the two in step if either changes.
 */
export function requiresEmergencyAuthority(
  alert: { level: EscalationLevel; override_level?: EscalationLevel | null } | null
): boolean {
  if (!alert) return false;
  return alert.level === "emergency" || alert.override_level === "emergency";
}

/** Effective severity DESC (emergency first), then sla_due_at ASC with nulls last. */
export function compareAlerts(
  a: { level: EscalationLevel; override_level?: EscalationLevel | null; sla_due_at: string | null },
  b: { level: EscalationLevel; override_level?: EscalationLevel | null; sla_due_at: string | null }
): number {
  const levelDiff = LEVEL_PRIORITY[effectiveAlertLevel(a)] - LEVEL_PRIORITY[effectiveAlertLevel(b)];
  if (levelDiff !== 0) return levelDiff;
  if (a.sla_due_at === null && b.sla_due_at === null) return 0;
  if (a.sla_due_at === null) return 1;
  if (b.sla_due_at === null) return -1;
  return a.sla_due_at.localeCompare(b.sla_due_at);
}

/**
 * Same ranking, for a worklist row whose alert is one hop away (e.g. an
 * escalation joined to its clinician_alert) rather than the row itself. A
 * null clinician_alert (no known real case today — every escalation is
 * raised from one — but the join is nullable in the schema) sorts last,
 * never crashes.
 */
type AlertJoinRow = {
  clinician_alert: {
    level: EscalationLevel;
    override_level?: EscalationLevel | null;
    sla_due_at?: string | null;
  } | null;
};

function rankOf(row: AlertJoinRow) {
  const alert = row.clinician_alert;
  return {
    level: alert?.level ?? ("routine" as EscalationLevel),
    override_level: alert?.override_level ?? null,
    sla_due_at: alert?.sla_due_at ?? null,
  };
}

export function compareByAlert(a: AlertJoinRow, b: AlertJoinRow): number {
  return compareAlerts(rankOf(a), rankOf(b));
}
