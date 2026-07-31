import type { EscalationStatus } from "@tarragon/shared";

/**
 * Honest, non-alarming "what happens next" line for a still-open follow-up —
 * closes the "why haven't I heard back" gap without inventing a promise the
 * platform can't keep. Takes the real sla_due_at the escalation engine
 * already computes (private.escalation_sla_minutes / escalation_slas), never
 * a fabricated number. A breached or missing SLA falls back to calm,
 * non-specific reassurance rather than showing a stale-looking deadline.
 */
export function whatHappensNext(status: EscalationStatus, slaDueAt: string | null): string | null {
  if (status !== "open" && status !== "under_review") return null;
  if (slaDueAt && new Date(slaDueAt).getTime() > Date.now()) {
    return `Your care team aims to get back to you by ${formatDueBy(slaDueAt)}.`;
  }
  return "Your care team is following up on this as a priority.";
}

function formatDueBy(slaDueAt: string): string {
  return new Date(slaDueAt).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}
