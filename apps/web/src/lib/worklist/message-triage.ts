/**
 * Ranking for the staff patient-messages worklist.
 *
 * The list used to be ordered purely by `last_message_at desc`, which puts
 * the thread the care team just answered at the top and buries the patient
 * who has been waiting since Tuesday. What a clinician needs first is the
 * opposite: threads waiting on a reply, longest wait first.
 *
 * Kept as pure functions over a structural type (rather than over
 * Tables<"care_message_threads">) so it can be unit-tested in the node
 * environment without pulling the Supabase client in.
 */

import { getProposedConfig, type ConfigValue } from "@tarragon/shared";

/** Read from the one config entry, so the badge and the database reminder cannot drift apart. */
export const REPLY_LOOKBACK_DAYS = (getProposedConfig<ConfigValue>("care_messages.reply_target").value as unknown as { lookbackDays: number }).lookbackDays;

export interface TriageableThread {
  status: string;
  last_message_at: string;
  /** 'patient' | 'care_team' | 'sponsor' — null on a thread with no messages yet. */
  last_message_author_role: string | null;
  /** When a staff member last opened the thread (mark_care_message_thread_read). */
  care_team_last_read_at: string | null;
}

/**
 * A thread is waiting on the care team when the last word came from the
 * patient's side and nobody has opened it since. A thread whose last message
 * is the care team's own reply is never "unread", however long ago it was:
 * the ball is with the patient.
 */
export function isAwaitingCareTeam(thread: TriageableThread): boolean {
  if (thread.status !== "open") return false;
  if (thread.last_message_author_role === "care_team") return false;
  if (thread.last_message_author_role === null) return false;
  if (!thread.care_team_last_read_at) return true;
  return new Date(thread.care_team_last_read_at).getTime() < new Date(thread.last_message_at).getTime();
}

/** How long the patient has been waiting on a reply, in ms. Null when nothing
 * is owed — an answered or closed thread has no wait time to display. */
export function waitingMs(thread: TriageableThread, now: number = Date.now()): number | null {
  if (!isAwaitingCareTeam(thread)) return null;
  return now - new Date(thread.last_message_at).getTime();
}

/** "4h" / "2d" / "just now" — a wait, phrased as a duration rather than a clock time. */
export function formatWait(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Waiting-on-us first, longest wait first; then everything else by most
 * recent activity. Closed threads always sort behind open ones so a resolved
 * conversation never sits above a patient still waiting.
 */
export function compareThreads(a: TriageableThread, b: TriageableThread): number {
  const aWaiting = isAwaitingCareTeam(a);
  const bWaiting = isAwaitingCareTeam(b);
  if (aWaiting !== bWaiting) return aWaiting ? -1 : 1;
  if (aWaiting && bWaiting) {
    // Oldest unanswered message first.
    return a.last_message_at.localeCompare(b.last_message_at);
  }
  const aClosed = a.status !== "open";
  const bClosed = b.status !== "open";
  if (aClosed !== bClosed) return aClosed ? 1 : -1;
  return b.last_message_at.localeCompare(a.last_message_at);
}

/**
 * Past the reply target: the patient's side spoke last and the care team has not answered within `targetHours`.
 * Unlike "awaiting" this does not clear when someone merely opens the thread; only a reply (or closing) does,
 * because the target is about the patient being answered, not about the message being seen.
 */
export function isPastReplyTarget(
  thread: Pick<TriageableThread, "status" | "last_message_at" | "last_message_author_role">,
  targetHours: number,
  now: number = Date.now(),
  lookbackDays: number = REPLY_LOOKBACK_DAYS,
): boolean {
  if (thread.status !== "open") return false;
  if (thread.last_message_author_role !== "patient" && thread.last_message_author_role !== "sponsor") return false;
  const waited = now - new Date(thread.last_message_at).getTime();
  // Older than the lookback is not flagged: it shows in the quiet "older" count instead, so an old thread whose author role
  // was only just filled in cannot suddenly raise a wave of red badges.
  return waited > targetHours * 3_600_000 && waited <= lookbackDays * 86_400_000;
}

/** Open conversations where the patient's side spoke last, past the lookback. Counted quietly, never badged. */
export function isOlderUnanswered(
  thread: Pick<TriageableThread, "status" | "last_message_at" | "last_message_author_role">,
  now: number = Date.now(),
  lookbackDays: number = REPLY_LOOKBACK_DAYS,
): boolean {
  if (thread.status !== "open") return false;
  if (thread.last_message_author_role !== "patient" && thread.last_message_author_role !== "sponsor") return false;
  return now - new Date(thread.last_message_at).getTime() > lookbackDays * 86_400_000;
}
