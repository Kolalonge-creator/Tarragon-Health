/**
 * S80d (Module 25.4): the support ticket clock.
 *
 * Pure. A ticket has two clocks, first reply and resolution, each with a target taken from the PROPOSED configuration `support.sla_targets`
 * (never written here). The clock only FLAGS a ticket on the staff queue; it never closes, reassigns or messages anyone, and it is not a
 * promise made to a patient.
 *
 *  - First reply: due `first_response_minutes[priority]` after the ticket was logged. A ticket flagged clinical uses the shorter of that and
 *    `clinical_first_response_minutes`. Once a reply exists the part is "met" (or "late" when the reply came after the target).
 *  - Resolution: due `resolution_hours[priority]` after it was logged. While the ticket is "awaiting_patient" the resolution clock is
 *    "paused" (the team is waiting on the patient, which is not a breach). A resolved or closed ticket is "met" or "late".
 *  - "due_soon" begins once `warn_fraction` of the target has passed.
 */
export const SLA_PRIORITIES = ["critical", "high", "normal", "low"] as const;
export type SlaPriority = (typeof SLA_PRIORITIES)[number];

export type SlaTargets = {
  readonly first_response_minutes: Readonly<Record<SlaPriority, number>>;
  readonly resolution_hours: Readonly<Record<SlaPriority, number>>;
  readonly clinical_first_response_minutes: number;
  readonly warn_fraction: number;
};

export type PartState = "ok" | "due_soon" | "breached" | "met" | "late" | "paused";

export interface ClockPart {
  readonly state: PartState;
  /** ISO time the part is due. */
  readonly dueAt: string;
  /** Minutes past due (positive) or left (negative). Null once the part is finished. */
  readonly minutesOver: number | null;
}

export interface TicketClockInput {
  readonly created_at: string;
  readonly first_response_at: string | null;
  readonly resolved_at: string | null;
  readonly status: string;
  readonly priority: SlaPriority;
  readonly is_clinical: boolean;
}

export interface TicketClock {
  readonly firstResponse: ClockPart;
  readonly resolution: ClockPart;
  /** The more urgent of the two, for sorting and the headline badge. */
  readonly worst: PartState;
}

const MIN = 60_000;
const RANK: Record<PartState, number> = { breached: 5, late: 4, due_soon: 3, ok: 2, paused: 1, met: 0 };

function part(createdMs: number, targetMinutes: number, doneAtMs: number | null, nowMs: number, warn: number, paused: boolean): ClockPart {
  const dueMs = createdMs + targetMinutes * MIN;
  const dueAt = new Date(dueMs).toISOString();
  if (doneAtMs !== null) return { state: doneAtMs <= dueMs ? "met" : "late", dueAt, minutesOver: null };
  const over = Math.round((nowMs - dueMs) / MIN);
  if (paused) return { state: "paused", dueAt, minutesOver: over };
  if (nowMs > dueMs) return { state: "breached", dueAt, minutesOver: over };
  const elapsed = nowMs - createdMs;
  return { state: elapsed >= targetMinutes * MIN * warn ? "due_soon" : "ok", dueAt, minutesOver: over };
}

export function ticketClock(t: TicketClockInput, now: Date, targets: SlaTargets): TicketClock {
  const created = Date.parse(t.created_at);
  const nowMs = now.getTime();
  const firstTarget = t.is_clinical
    ? Math.min(targets.first_response_minutes[t.priority], targets.clinical_first_response_minutes)
    : targets.first_response_minutes[t.priority];
  const firstDone = t.first_response_at ? Date.parse(t.first_response_at) : null;
  const finished = t.status === "resolved" || t.status === "closed";
  const resolvedMs = finished ? (t.resolved_at ? Date.parse(t.resolved_at) : nowMs) : null;
  const firstResponse = part(created, firstTarget, firstDone, nowMs, targets.warn_fraction, false);
  const resolution = part(created, targets.resolution_hours[t.priority] * 60, resolvedMs, nowMs, targets.warn_fraction, t.status === "awaiting_patient");
  const worst = RANK[firstResponse.state] >= RANK[resolution.state] ? firstResponse.state : resolution.state;
  return { firstResponse, resolution, worst };
}

/** True when either part is past its target and the ticket is still open. */
export const isBreached = (c: TicketClock): boolean => c.firstResponse.state === "breached" || c.resolution.state === "breached";

/** A short plain description for the queue badge. */
export function describeClock(c: TicketClock): string {
  const pick = c.firstResponse.state === "breached" || c.firstResponse.state === "due_soon" ? { name: "First reply", p: c.firstResponse } : { name: "Resolution", p: c.resolution };
  switch (pick.p.state) {
    case "breached":
      return `${pick.name} ${formatMinutes(pick.p.minutesOver ?? 0)} overdue`;
    case "due_soon":
      return `${pick.name} due in ${formatMinutes(Math.abs(pick.p.minutesOver ?? 0))}`;
    case "paused":
      return "Waiting on the patient";
    case "late":
      return `${pick.name} was late`;
    case "met":
      return "Within target";
    default:
      return `${pick.name} due in ${formatMinutes(Math.abs(pick.p.minutesOver ?? 0))}`;
  }
}

export function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  if (m < 90) return `${m} min`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / (24 * 60))} days`;
}

/** Open tickets, past-target first, then by how long they have been waiting. Stable for ties. */
export function sortByClock<T extends { readonly created_at: string }>(rows: readonly T[], clockOf: (r: T) => TicketClock): T[] {
  return [...rows]
    .map((r, i) => ({ r, i, c: clockOf(r) }))
    .sort((a, b) => RANK[b.c.worst] - RANK[a.c.worst] || Date.parse(a.r.created_at) - Date.parse(b.r.created_at) || a.i - b.i)
    .map((x) => x.r);
}
