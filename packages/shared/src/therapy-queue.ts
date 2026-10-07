/**
 * Offline-friendly handling of programme sessions (S63), shared by web and mobile. Pure code over an injected store, so it runs and tests
 * with no browser or phone.
 *
 *  - A session that has been opened is kept on the device (text only, a few kilobytes) so it can be read again with no signal. The
 *    cache is local to this device and is removed when the patient stops the programme or a session needs a fresh safety re-check.
 *  - A finished session that could not be sent is queued on the device and sent when the network returns. Sending it again is safe:
 *    the database answers a repeat as "already saved". The re-check that fail-closes a programme happens when a session is OPENED
 *    (online); a queued completion never skips it.
 *  - Nothing here stores a diary. A diary note stays on the device and is never sent unless the patient opts in (mayUploadDiary).
 */

export interface AsyncStore {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}

export interface QueuedCompletion {
  enrolmentId: string;
  ordinal: number;
  scores: Record<string, number> | null;
  queuedAt: string;
}

const QUEUE_KEY = "tarragon.therapy.queue.v1";
const SESSION_PREFIX = "tarragon.therapy.session.v1.";

export const sessionCacheKey = (enrolmentId: string, ordinal: number): string => `${SESSION_PREFIX}${enrolmentId}.${ordinal}`;

function parseQueue(raw: string | null): QueuedCompletion[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (q): q is QueuedCompletion =>
        typeof q === "object" && q !== null && typeof (q as QueuedCompletion).enrolmentId === "string" && Number.isInteger((q as QueuedCompletion).ordinal),
    );
  } catch {
    return [];
  }
}

export async function readQueue(store: AsyncStore): Promise<QueuedCompletion[]> {
  try {
    return parseQueue(await store.getItem(QUEUE_KEY));
  } catch {
    return [];
  }
}

/** Adds a completion to the queue once. A repeat of the same session replaces the earlier entry. Returns false when the device store failed. */
export async function enqueueCompletion(store: AsyncStore, item: QueuedCompletion): Promise<boolean> {
  try {
    const q = (await readQueue(store)).filter((x) => !(x.enrolmentId === item.enrolmentId && x.ordinal === item.ordinal));
    q.push(item);
    await store.setItem(QUEUE_KEY, JSON.stringify(q));
    return true;
  } catch {
    return false;
  }
}

/**
 * Tries to send every queued completion. `send` returns "sent" (saved, or the database says it is already saved or the programme is no
 * longer running: either way retrying cannot help), or "retry" (network or server trouble: keep it). An item that was sent is removed.
 */
export async function flushQueue(
  store: AsyncStore,
  send: (item: QueuedCompletion) => Promise<"sent" | "retry">,
): Promise<{ sent: number; kept: number }> {
  const q = await readQueue(store);
  const kept: QueuedCompletion[] = [];
  let sent = 0;
  for (const item of q) {
    let outcome: "sent" | "retry";
    try {
      outcome = await send(item);
    } catch {
      outcome = "retry";
    }
    if (outcome === "sent") sent += 1;
    else kept.push(item);
  }
  try {
    if (kept.length === 0) await store.removeItem(QUEUE_KEY);
    else await store.setItem(QUEUE_KEY, JSON.stringify(kept));
  } catch {
    /* the queue stays as it was; a repeat send is safe */
  }
  return { sent, kept: kept.length };
}

export interface CachedSession {
  title: string;
  kind: string;
  text: string;
  ordinal: number;
  totalSessions: number;
  programmeTitle: string;
  checkpoint: boolean;
  instruments: string[];
  cachedAt: string;
}

export async function cacheSession(store: AsyncStore, enrolmentId: string, s: CachedSession): Promise<void> {
  try {
    await store.setItem(sessionCacheKey(enrolmentId, s.ordinal), JSON.stringify(s));
  } catch {
    /* no cache is not an error: the session just cannot be re-read offline */
  }
}

export async function readCachedSession(store: AsyncStore, enrolmentId: string, ordinal: number): Promise<CachedSession | null> {
  try {
    const raw = await store.getItem(sessionCacheKey(enrolmentId, ordinal));
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const s = v as CachedSession;
    return typeof s.text === "string" && typeof s.title === "string" && Number.isInteger(s.ordinal) ? s : null;
  } catch {
    return null;
  }
}

export async function clearCachedSession(store: AsyncStore, enrolmentId: string, ordinal: number): Promise<void> {
  try {
    await store.removeItem(sessionCacheKey(enrolmentId, ordinal));
  } catch {
    /* nothing to do */
  }
}
