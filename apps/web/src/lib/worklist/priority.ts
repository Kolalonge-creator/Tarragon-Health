import type { EscalationLevel } from "@tarragon/shared";

const LEVEL_PRIORITY: Record<EscalationLevel, number> = {
  emergency: 0,
  urgent_escalation: 1,
  clinician_review: 2,
  routine: 3,
};

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
