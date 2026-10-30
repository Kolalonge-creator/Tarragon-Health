import { CHILD_EVENT_KINDS, CHILD_FEED_TYPES, type ChildEvent, type ChildEventKind, type ChildFeedType } from "./daily-events";

/**
 * Turns a row read from child_daily_events (an unknown shape coming over the wire) into a ChildEvent, or null when it is not one. The tables are
 * new and not in the generated client types yet, so both apps read them as unknown and validate here instead of casting to `any`.
 */

/** A ChildEvent plus the phone's outbox id it was sent with (null for rows from the web or before S68b). */
export type ChildEventRow = ChildEvent & { readonly clientId: string | null };

export function childEventFromRow(row: unknown): ChildEventRow | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.occurred_at !== "string") return null;
  if (!(CHILD_EVENT_KINDS as readonly string[]).includes(r.kind as string)) return null;
  const feed = typeof r.feed_type === "string" && (CHILD_FEED_TYPES as readonly string[]).includes(r.feed_type) ? (r.feed_type as ChildFeedType) : null;
  return {
    id: r.id,
    kind: r.kind as ChildEventKind,
    occurredAt: r.occurred_at,
    feedType: feed,
    loggedBy: typeof r.logged_by_label === "string" && r.logged_by_label.length > 0 ? r.logged_by_label : null,
    correctsId: typeof r.corrects_id === "string" ? r.corrects_id : null,
    pendingOnPhone: false,
    clientId: typeof r.client_id === "string" ? r.client_id : null,
  };
}

export function childEventsFromRows(rows: unknown): ChildEventRow[] {
  return Array.isArray(rows) ? rows.map(childEventFromRow).filter((e): e is ChildEventRow => e !== null) : [];
}

/** The server's copy and the phone's own copy of the same tap: the server row wins and the pending one is dropped (same client id). */
export function mergePending(server: readonly ChildEventRow[], pending: readonly ChildEventRow[]): ChildEventRow[] {
  const sent = new Set(server.map((s) => s.clientId).filter((c): c is string => typeof c === "string"));
  return [...server, ...pending.filter((p) => p.clientId === null || !sent.has(p.clientId))];
}
