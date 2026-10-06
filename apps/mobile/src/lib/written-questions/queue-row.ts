import type { QueuedItem, QueuedPhoto } from "./queue";
import { WRITTEN_QUESTION_CATEGORIES } from "./types";

export interface QueueRow {
  clientId: string;
  userId: string;
  createdAt: number;
  item: string;
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isQueuedPhoto(value: unknown): value is QueuedPhoto {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.bytes === "number" &&
    typeof value.uploaded === "boolean" &&
    typeof value.registered === "boolean"
  );
}

/**
 * True only when every field the flush reads is present and the right type. A row that parses as
 * JSON but is missing the photos list (or has a wrong state) would make the flush throw every
 * minute without ever surfacing, so it is treated as unreadable instead.
 */
export function isQueuedItem(value: unknown): value is QueuedItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.clientId === "string" &&
    typeof value.userId === "string" &&
    typeof value.category === "string" &&
    (WRITTEN_QUESTION_CATEGORIES as readonly string[]).includes(value.category) &&
    typeof value.question === "string" &&
    typeof value.durationNote === "string" &&
    typeof value.createdAt === "number" &&
    (value.consultId === null || typeof value.consultId === "string") &&
    Array.isArray(value.photos) &&
    value.photos.every(isQueuedPhoto) &&
    typeof value.photosDropped === "number" &&
    typeof value.attempts === "number" &&
    (value.lastError === null || typeof value.lastError === "string") &&
    typeof value.nextAttemptAt === "number" &&
    (value.state === "queued" || value.state === "returned") &&
    (value.returnedKey === null || typeof value.returnedKey === "string")
  );
}

/**
 * Turns a stored row into an item. A row whose JSON cannot be read is never hidden: it comes back
 * as a returned item (built from the row's own columns) so the patient sees a message and can
 * discard it, which also removes its photos. A question must never be lost without a trace.
 */
export function parseOrQuarantine(row: QueueRow): QueuedItem {
  try {
    const value: unknown = JSON.parse(row.item);
    if (isQueuedItem(value)) return value;
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
