/**
 * Queue-and-retry for a draft request that could not be sent (S76-S80). Client side only; no audio is ever queued.
 *
 * The queued request holds the clinician's typed visit notes, which are patient information, so it lives in sessionStorage (gone when the tab
 * closes), expires after a short time (PROPOSED config), is replaced rather than stacked (one pending request per note), and is removed as
 * soon as it is sent or discarded. Storage that cannot be read or written means nothing is queued and the screen says so; it never throws.
 */
import { getProposedConfig } from "@tarragon/shared";

export interface QueuedDraftRequest {
  noteId: string;
  consentId: string;
  text: string;
  queuedAt: number;
}

const KEY_PREFIX = "tarragon.scribe.pending.";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function ttlMs(): number {
  return getProposedConfig<{ offline_queue_ttl_minutes: number }>("scribe.review_rules").value.offline_queue_ttl_minutes * 60_000;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/** True when the failure looks like the device is offline rather than a refusal from the server. */
export function isOfflineError(err: unknown, online: boolean = typeof navigator === "undefined" ? true : navigator.onLine): boolean {
  if (!online) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(msg);
}

export function queueDraftRequest(req: Omit<QueuedDraftRequest, "queuedAt">, now: number = Date.now(), storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(KEY_PREFIX + req.noteId, JSON.stringify({ ...req, queuedAt: now }));
    return true;
  } catch {
    return false;
  }
}

export function readQueuedDraftRequest(noteId: string, now: number = Date.now(), storage: StorageLike | null = defaultStorage()): QueuedDraftRequest | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(KEY_PREFIX + noteId);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<QueuedDraftRequest>;
    if (typeof v.noteId !== "string" || typeof v.consentId !== "string" || typeof v.text !== "string" || typeof v.queuedAt !== "number") {
      storage.removeItem(KEY_PREFIX + noteId);
      return null;
    }
    if (now - v.queuedAt > ttlMs()) {
      storage.removeItem(KEY_PREFIX + noteId);
      return null;
    }
    return v as QueuedDraftRequest;
  } catch {
    return null;
  }
}

export function clearQueuedDraftRequest(noteId: string, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(KEY_PREFIX + noteId);
  } catch {
    /* nothing to clear */
  }
}
