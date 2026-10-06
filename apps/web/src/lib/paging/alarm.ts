import type { ActivePage } from "./schemas";

/** Pages that still need a person: nobody has acknowledged the event yet. An acknowledged page stays open for notes but does not ring. */
export function pagesNeedingAction(pages: readonly ActivePage[]): ActivePage[] {
  return pages.filter((p) => p.acknowledged_at === null);
}

/** "3 min 05 s" for a waiting time; never negative, never a bare number a tired person has to interpret. */
export function formatWaiting(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m} min ${String(s % 60).padStart(2, "0")} s`;
}

/** The level-2 line is for the clinical lead; the wording says what is wanted, not which patient or why. */
export function pageHeadline(p: Pick<ActivePage, "role" | "escalation_level">): string {
  if (p.role === "escalation") return "A priority case has not been picked up. Take it or hand it on now.";
  if (p.role === "backup") return "Backup: the first clinician has not answered a priority case.";
  return "A priority case needs you now.";
}

/** How often the banner asks the server while a page rings (fast) and while nothing does (slow). */
export const POLL_RINGING_MS = 10_000;
export const POLL_QUIET_MS = 20_000;

export function nextPollMs(ringing: boolean): number {
  return ringing ? POLL_RINGING_MS : POLL_QUIET_MS;
}
