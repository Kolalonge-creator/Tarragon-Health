import type { EscalationLevel } from "@tarragon/shared";

const LEVEL_PRIORITY: Record<EscalationLevel, number> = {
  emergency: 0,
  urgent_escalation: 1,
  clinician_review: 2,
  routine: 3,
};

/** Severity DESC (emergency first), then sla_due_at ASC with nulls last. */
export function compareAlerts(
  a: { level: EscalationLevel; sla_due_at: string | null },
  b: { level: EscalationLevel; sla_due_at: string | null }
): number {
  const levelDiff = LEVEL_PRIORITY[a.level] - LEVEL_PRIORITY[b.level];
  if (levelDiff !== 0) return levelDiff;
  if (a.sla_due_at === null && b.sla_due_at === null) return 0;
  if (a.sla_due_at === null) return 1;
  if (b.sla_due_at === null) return -1;
  return a.sla_due_at.localeCompare(b.sla_due_at);
}
