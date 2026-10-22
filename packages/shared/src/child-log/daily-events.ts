import { childLogSettings, type ChildLogSettings } from "./settings";

/**
 * The one-tap daily log for a child (S68b). Events are APPEND-ONLY: nothing is edited or deleted from the phone. A mistake is fixed by a
 * correcting event (`corrects_id`), and the timeline then hides the row that was corrected. The database is the authority
 * (public.child_daily_events); this file is the pure part that both apps share.
 */
export const CHILD_EVENT_KINDS = ["feed", "sleep_start", "sleep_stop", "nappy_wet", "nappy_dirty"] as const;
export type ChildEventKind = (typeof CHILD_EVENT_KINDS)[number];

export const CHILD_FEED_TYPES = ["breast", "bottle", "other"] as const;
export type ChildFeedType = (typeof CHILD_FEED_TYPES)[number];

export interface ChildEvent {
  readonly id: string;
  readonly kind: ChildEventKind;
  readonly occurredAt: string;
  readonly feedType: ChildFeedType | null;
  /** A caregiver label ("Mum", "Aunty Ngozi"). A label on an entry, never an account. */
  readonly loggedBy: string | null;
  readonly correctsId: string | null;
  /** True while the entry is only saved on this phone and has not reached the server. */
  readonly pendingOnPhone: boolean;
}

/**
 * Cleans a caregiver label typed on a shared phone: trimmed, whitespace collapsed, control characters and angle brackets removed, cut to the
 * configured length. Empty becomes null (the entry then simply has no label). It is a name tag for the family, not an identity.
 */
export function cleanCaregiverLabel(raw: string | null | undefined, settings: ChildLogSettings = childLogSettings().settings): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, settings.caregiver_label_max_chars)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** An entry cannot be dated in the future (a small clock skew is allowed). */
export function eventTimeOk(occurredAtIso: string, nowMs: number, skewMinutes = 5): boolean {
  const t = Date.parse(occurredAtIso);
  return Number.isFinite(t) && t <= nowMs + skewMinutes * 60_000;
}

/** Drops every row that a later correcting event points at, so the timeline never shows both. */
export function withoutCorrected<T extends { id: string; correctsId: string | null }>(events: readonly T[]): T[] {
  const corrected = new Set(events.map((e) => e.correctsId).filter((x): x is string => x !== null));
  return events.filter((e) => !corrected.has(e.id));
}

export interface SleepSpan {
  readonly startId: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  /** Whole minutes; null while the child is still asleep. */
  readonly minutes: number | null;
}

/**
 * Pairs sleep_start with the next sleep_stop. A start with no stop after it is "asleep now". A stop with no start before it is ignored for the
 * duration (it still shows as an event). Spans come back oldest first.
 */
export function pairSleep(events: readonly Pick<ChildEvent, "id" | "kind" | "occurredAt">[]): SleepSpan[] {
  const sorted = [...events]
    .filter((e) => e.kind === "sleep_start" || e.kind === "sleep_stop")
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const spans: SleepSpan[] = [];
  let open: { id: string; at: string } | null = null;
  for (const e of sorted) {
    if (e.kind === "sleep_start") {
      if (open) spans.push({ startId: open.id, startedAt: open.at, endedAt: null, minutes: null });
      open = { id: e.id, at: e.occurredAt };
    } else if (open) {
      spans.push({ startId: open.id, startedAt: open.at, endedAt: e.occurredAt, minutes: Math.max(0, Math.round((Date.parse(e.occurredAt) - Date.parse(open.at)) / 60_000)) });
      open = null;
    }
  }
  if (open) spans.push({ startId: open.id, startedAt: open.at, endedAt: null, minutes: null });
  return spans;
}

/** Is the child asleep right now (the latest sleep event is a start)? Decides whether the big sleep button says "Asleep" or "Woke up". */
export function isAsleepNow(events: readonly Pick<ChildEvent, "kind" | "occurredAt">[]): boolean {
  const last = [...events]
    .filter((e) => e.kind === "sleep_start" || e.kind === "sleep_stop")
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))[0];
  return last?.kind === "sleep_start";
}
