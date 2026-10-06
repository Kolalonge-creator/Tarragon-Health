import type { QueuedItem } from "./queue";

export interface QueueRow {
  clientId: string;
  userId: string;
  createdAt: number;
  item: string;
}

/**
 * Turns a stored row into an item. A row whose JSON cannot be read is never hidden: it comes back
 * as a returned item (built from the row's own columns) so the patient sees a message and can
 * discard it, which also removes its photos. A question must never be lost without a trace.
 */
export function parseOrQuarantine(row: QueueRow): QueuedItem {
  try {
    const value: unknown = JSON.parse(row.item);
    if (typeof value === "object" && value !== null) {
      const candidate = value as Partial<QueuedItem>;
      if (typeof candidate.clientId === "string" && typeof candidate.userId === "string") {
        return candidate as QueuedItem;
      }
    }
  } catch {
    // fall through to the quarantined item
  }
  return {
    clientId: row.clientId,
    userId: row.userId,
    category: "general",
    question: "",
    durationNote: "",
    createdAt: row.createdAt,
    consultId: null,
    photos: [],
    photosDropped: 0,
    attempts: 0,
    lastError: "unreadable",
    nextAttemptAt: 0,
    state: "returned",
    returnedKey: "wq.error.generic",
  };
}
