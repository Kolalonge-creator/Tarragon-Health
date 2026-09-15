import type { BadgeProps } from "@/components/ui/badge";

/**
 * How long a case has been waiting, and how long is left on its SLA.
 *
 * Both were previously copy-pasted local helpers inside individual worklist
 * components, which is how the escalation worklist ended up with a binary
 * "Overdue" badge (a case ten minutes from breaching looked identical to one
 * raised five minutes ago) while the operations queue two directories over
 * already rendered "43m left" / "2h overdue". One module, one wording, every
 * queue.
 *
 * `now` is injectable so the behaviour is testable without freezing the
 * clock; every caller uses the default.
 */

/** "just now" / "12m ago" / "5h ago" / "3d ago" — how long a row has waited. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Milliseconds a row has been waiting. Negative is impossible in practice
 * (a future created_at), but is returned as-is rather than clamped so a bad
 * timestamp shows up as odd rather than as "waiting no time at all". */
export function ageMs(iso: string, now: number = Date.now()): number {
  return now - new Date(iso).getTime();
}

export interface SlaLabel {
  /** "43m left" or "2h overdue". */
  text: string;
  overdue: boolean;
  /** Inside the last hour of the SLA, but not yet breached. */
  imminent: boolean;
}

/**
 * The countdown a clinician actually triages on. Returns null when the row
 * carries no SLA at all, which is a real state (a manually raised escalation
 * has no clinician_alert, so no sla_due_at) and must render as "no SLA", never
 * as "on time".
 */
export function slaLabel(slaDueAt: string | null | undefined, now: number = Date.now()): SlaLabel | null {
  if (!slaDueAt) return null;
  const diffMs = new Date(slaDueAt).getTime() - now;
  const overdue = diffMs < 0;
  const mins = Math.round(Math.abs(diffMs) / 60_000);
  const text =
    mins < 60
      ? `${mins}m`
      : mins < 60 * 24
        ? `${Math.round(mins / 60)}h`
        : `${Math.round(mins / (60 * 24))}d`;
  return {
    text: overdue ? `${text} overdue` : `${text} left`,
    overdue,
    imminent: !overdue && diffMs <= 60 * 60_000,
  };
}

/**
 * Clinical status colour for an SLA chip: red once breached, amber in the
 * final hour, grey while there is comfortable time left. This is the
 * dashboard status system (green/amber/red/blue/grey), deliberately separate
 * from brand colour — see CLAUDE.md's Brand section.
 */
export function slaBadgeVariant(sla: SlaLabel): NonNullable<BadgeProps["variant"]> {
  if (sla.overdue) return "red";
  if (sla.imminent) return "amber";
  return "grey";
}
