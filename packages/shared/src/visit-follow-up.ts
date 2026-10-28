import { getProposedConfig } from "./proposed-config";

const LATEST = "9999-12-31";

/**
 * How long the after-visit summary (AVS) keeps the "questions about this visit?" prompt in front of the person. Pure: no clock of
 * its own, no I/O.
 *
 * What this is, and what it is not. It is a prompt that makes the existing in-app conversation with the care team easy to find
 * right after a visit, when questions arise. It does not create an entitlement, change a price, extend or return a written-question
 * allowance, or promise a response time: messaging with the care team has no charge mechanism today, and the written-question
 * follow-up window (async_question.behaviour followUpDays) is unchanged. After the window the prompt simply stops showing; the
 * person can still message their care team from Messages at any time.
 *
 * The number of days is PROPOSED configuration (visit.follow_up_prompt), never a literal. The founder confirms it.
 */
export interface VisitFollowUpConfig {
  version: number;
  windowMs: number;
}

export function loadVisitFollowUpConfig(): VisitFollowUpConfig {
  // The newest version, whatever the device clock says: a phone with a wrong or reset date must never throw while a screen renders (the
  // entry takes effect on a fixed date, and an earlier "today" would otherwise find no entry at all). This only sets display wording.
  const entry = getProposedConfig<{ readonly [k: string]: number }>("visit.follow_up_prompt", LATEST);
  const days = entry.value.days;
  if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) throw new Error("visit.follow_up_prompt.days is not a positive number");
  return { version: entry.version, windowMs: days * 86_400_000 };
}

/** True from the moment the summary was approved until the window ends. An unreadable or future approval time shows nothing. */
export function visitFollowUpOpen(approvedAt: string | null | undefined, nowMs: number, config: VisitFollowUpConfig = loadVisitFollowUpConfig()): boolean {
  if (!approvedAt) return false;
  const at = Date.parse(approvedAt);
  if (!Number.isFinite(at) || !Number.isFinite(nowMs)) return false;
  const age = nowMs - at;
  if (age < -5 * 60_000) return false;
  return age < config.windowMs;
}
