import type { MessageKey } from "@tarragon/i18n";
import { backoffMs } from "../outbox-rules";
import { photoStoragePath } from "./limits";
import type { WrittenQuestionCategory } from "./types";

/**
 * The durable queue for written questions (S22 follow-up). A question must never be lost to a
 * dead battery or no signal: tapping Send writes the item (and each photo's cleaned bytes) to the
 * phone first, then a flush tries to send it. The flush is resumable and idempotent:
 * submit_written_question and attach_written_question_photo both dedupe on the server, and each
 * step is recorded before the next begins, so an interruption anywhere resumes without a second
 * submit and without re-uploading a finished photo. Pure logic: storage and network are injected.
 *
 * Items are keyed by the signed-in patient's id. Another account's items are never read or sent.
 */
export interface QueuedPhoto {
  id: string;
  bytes: number;
  uploaded: boolean;
  registered: boolean;
}

export interface QueuedItem {
  clientId: string;
  userId: string;
  category: WrittenQuestionCategory;
  question: string;
  durationNote: string;
  createdAt: number;
  /** The server's consult id, once submit has succeeded. */
  consultId: string | null;
  photos: QueuedPhoto[];
  photosDropped: number;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: number;
  /** `returned`: refused for good; the text and photos wait to go back into the draft. */
  state: "queued" | "returned";
  returnedKey: MessageKey | null;
}

export interface QueueStore {
  /** Writes the item and its photo bytes together (all or nothing). */
  insert(item: QueuedItem, photos: { id: string; bytes: Uint8Array }[]): Promise<void>;
  update(item: QueuedItem): Promise<void>;
  list(userId: string): Promise<QueuedItem[]>;
  loadPhoto(clientId: string, photoId: string): Promise<Uint8Array | null>;
  /** Removes the item and every stored photo of it. */
  remove(clientId: string): Promise<void>;
}

export type RemoteFailure = { ok: false; final: boolean; key: MessageKey; message?: string };

export interface QueueRemote {
  submit(input: {
    clientId: string;
    category: WrittenQuestionCategory;
    question: string;
    durationNote: string;
  }): Promise<{ ok: true; id: string } | RemoteFailure>;
  /** An "already exists" answer counts as done: the first upload of this path won. */
  upload(path: string, bytes: Uint8Array): Promise<{ ok: true } | { ok: false }>;
  register(consultId: string, path: string, byteCount: number): Promise<{ ok: true } | { ok: false; dropPhoto: boolean }>;
}

export interface EnqueueInput {
  category: WrittenQuestionCategory;
  question: string;
  durationNote: string;
  photos: { bytes: Uint8Array }[];
}

export interface FlushSummary {
  sent: number;
  returned: number;
  /** Items still waiting (a failed step, or not yet due). */
  waiting: number;
  /** True when a step failed for a reason a retry may clear. */
  failed: boolean;
}

export interface QueueDeps {
  store: QueueStore;
  remote: QueueRemote;
  now?: () => number;
  newId: () => string;
}

export function createWrittenQuestionQueue(deps: QueueDeps) {
  const now = deps.now ?? Date.now;
  let inFlight: Promise<FlushSummary> | null = null;

  async function enqueue(userId: string, input: EnqueueInput): Promise<QueuedItem> {
    const photoBytes = input.photos.map((p) => ({ id: deps.newId(), bytes: p.bytes }));
    const item: QueuedItem = {
      clientId: deps.newId(),
      userId,
      category: input.category,
      question: input.question.trim(),
      durationNote: input.durationNote.trim(),
      createdAt: now(),
      consultId: null,
      photos: photoBytes.map((p) => ({ id: p.id, bytes: p.bytes.length, uploaded: false, registered: false })),
      photosDropped: 0,
      attempts: 0,
      lastError: null,
      nextAttemptAt: 0,
      state: "queued",
      returnedKey: null,
    };
    await deps.store.insert(item, photoBytes);
    return item;
  }

  function list(userId: string): Promise<QueuedItem[]> {
    return deps.store.list(userId);
  }

  async function discard(userId: string, clientId: string): Promise<boolean> {
    const items = await deps.store.list(userId);
    if (!items.some((i) => i.clientId === clientId)) return false;
    await deps.store.remove(clientId);
    return true;
  }

  async function fail(item: QueuedItem, message: string): Promise<void> {
    const attempts = item.attempts + 1;
    await deps.store.update({
      ...item,
      attempts,
      lastError: message,
      nextAttemptAt: now() + backoffMs(attempts),
    });
  }

  /** Runs one item as far as it will go. "stop" means a retryable failure was recorded. */
  async function runItem(start: QueuedItem): Promise<"sent" | "returned" | "stop"> {
    let item = start;

    if (item.consultId === null) {
      const result = await deps.remote.submit({
        clientId: item.clientId,
        category: item.category,
        question: item.question,
        durationNote: item.durationNote,
      });
      if (!result.ok) {
        if (result.final) {
          await deps.store.update({ ...item, state: "returned", returnedKey: result.key, lastError: result.message ?? null });
          return "returned";
        }
        await fail(item, result.message ?? "send failed");
        return "stop";
      }
      item = { ...item, consultId: result.id, lastError: null };
      await deps.store.update(item);
    }

    const consultId = item.consultId;
    if (consultId === null) return "stop";

    for (const photo of item.photos) {
      if (photo.uploaded && photo.registered) continue;
      const path = photoStoragePath(item.userId, consultId, photo.id);

      if (!photo.uploaded) {
        const bytes = await deps.store.loadPhoto(item.clientId, photo.id);
        if (!bytes) {
          item = markPhoto(item, photo.id, { uploaded: true, registered: true }, true);
          await deps.store.update(item);
          continue;
        }
        const up = await deps.remote.upload(path, bytes);
        if (!up.ok) {
          await fail(item, "photo upload failed");
          return "stop";
        }
        item = markPhoto(item, photo.id, { uploaded: true });
        await deps.store.update(item);
      }

      const reg = await deps.remote.register(consultId, path, photo.bytes);
      if (!reg.ok) {
        if (reg.dropPhoto) {
          item = markPhoto(item, photo.id, { uploaded: true, registered: true }, true);
          await deps.store.update(item);
          continue;
        }
        await fail(item, "photo register failed");
        return "stop";
      }
      item = markPhoto(item, photo.id, { registered: true });
      await deps.store.update(item);
    }

    await deps.store.remove(item.clientId);
    return "sent";
  }

  function markPhoto(item: QueuedItem, photoId: string, patch: Partial<QueuedPhoto>, dropped = false): QueuedItem {
    return {
      ...item,
      photosDropped: item.photosDropped + (dropped ? 1 : 0),
      photos: item.photos.map((p) => (p.id === photoId ? { ...p, ...patch } : p)),
    };
  }

  async function run(userId: string, force: boolean): Promise<FlushSummary> {
    const summary: FlushSummary = { sent: 0, returned: 0, waiting: 0, failed: false };
    const items = (await deps.store.list(userId))
      .filter((i) => i.state === "queued")
      .sort((a, b) => a.createdAt - b.createdAt);
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item) continue;
      if (!force && item.nextAttemptAt > now()) {
        summary.waiting += 1;
        continue;
      }
      let outcome: "sent" | "returned" | "stop";
      try {
        outcome = await runItem(item);
      } catch (error) {
        await fail(item, error instanceof Error ? error.message : "send failed");
        outcome = "stop";
      }
      if (outcome === "sent") summary.sent += 1;
      else if (outcome === "returned") summary.returned += 1;
      else {
        // A failure is usually the connection: do not hammer the rest, keep the order.
        summary.failed = true;
        summary.waiting += items.length - index;
        break;
      }
    }
    return summary;
  }

  /**
   * Sends what is due for this patient. Two callers at once share one run, so the same item is
   * never in flight twice. `force` ignores the back-off (foreground, sign-in, a manual pull).
   */
  function flush(userId: string, opts: { force?: boolean } = {}): Promise<FlushSummary> {
    if (!inFlight) {
      inFlight = run(userId, opts.force === true).finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  function photoBytes(clientId: string, photoId: string): Promise<Uint8Array | null> {
    return deps.store.loadPhoto(clientId, photoId);
  }

  return { enqueue, list, discard, flush, photoBytes };
}

export type WrittenQuestionQueue = ReturnType<typeof createWrittenQuestionQueue>;
