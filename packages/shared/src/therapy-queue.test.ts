import { describe, expect, it } from "@jest/globals";
import {
  cacheSession, clearCachedSession, enqueueCompletion, flushQueue, readCachedSession, readQueue, sessionCacheKey,
  type AsyncStore, type CachedSession, type QueuedCompletion,
} from "./therapy-queue";

function memoryStore(failWrites = false): AsyncStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { if (failWrites) throw new Error("full"); data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
  };
}
const item = (ordinal: number): QueuedCompletion => ({ enrolmentId: "e1", ordinal, scores: ordinal === 1 ? { phq9: 8 } : null, queuedAt: "2026-10-07T00:00:00Z" });
const session: CachedSession = { title: "T", kind: "education", text: "Body", ordinal: 2, totalSessions: 6, programmeTitle: "P", checkpoint: false, instruments: [], cachedAt: "2026-10-07T00:00:00Z" };

describe("offline completion queue", () => {
  it("queues a completion once and replaces a repeat", async () => {
    const s = memoryStore();
    expect(await enqueueCompletion(s, item(1))).toBe(true);
    expect(await enqueueCompletion(s, item(1))).toBe(true);
    expect(await enqueueCompletion(s, item(2))).toBe(true);
    expect((await readQueue(s)).map((q) => q.ordinal)).toEqual([1, 2]);
  });

  it("removes what was sent and keeps what must be retried", async () => {
    const s = memoryStore();
    await enqueueCompletion(s, item(1));
    await enqueueCompletion(s, item(2));
    const r = await flushQueue(s, async (q) => (q.ordinal === 1 ? "sent" : "retry"));
    expect(r).toEqual({ sent: 1, kept: 1 });
    expect((await readQueue(s)).map((q) => q.ordinal)).toEqual([2]);
    expect(await flushQueue(s, async () => "sent")).toEqual({ sent: 1, kept: 0 });
    expect(await readQueue(s)).toEqual([]);
  });

  it("treats a thrown send as a retry, never a loss", async () => {
    const s = memoryStore();
    await enqueueCompletion(s, item(1));
    const r = await flushQueue(s, async () => { throw new Error("offline"); });
    expect(r).toEqual({ sent: 0, kept: 1 });
    expect(await readQueue(s)).toHaveLength(1);
  });

  it("says so when the device store cannot be written, and survives a corrupt queue", async () => {
    expect(await enqueueCompletion(memoryStore(true), item(1))).toBe(false);
    const s = memoryStore();
    s.data.set("tarragon.therapy.queue.v1", "{not json");
    expect(await readQueue(s)).toEqual([]);
    s.data.set("tarragon.therapy.queue.v1", JSON.stringify([{ nope: true }, item(3)]));
    expect((await readQueue(s)).map((q) => q.ordinal)).toEqual([3]);
  });
});

describe("queue on a shared phone", () => {
  it("sends only the signed-in person's own items and keeps the rest", async () => {
    const s = memoryStore();
    await enqueueCompletion(s, { ...item(1), userId: "A" });
    await enqueueCompletion(s, { ...item(2), userId: "B" });
    const sentFor: number[] = [];
    const r = await flushQueue(s, async (q) => { sentFor.push(q.ordinal); return "sent"; }, "B");
    expect(sentFor).toEqual([2]);
    expect(r).toEqual({ sent: 1, kept: 1 });
    expect((await readQueue(s)).map((q) => q.userId)).toEqual(["A"]);
  });
});

describe("session cache", () => {
  it("keeps an opened session for offline reading and clears it", async () => {
    const s = memoryStore();
    await cacheSession(s, "e1", session);
    expect(s.data.has(sessionCacheKey("e1", 2))).toBe(true);
    expect(await readCachedSession(s, "e1", 2)).toEqual(session);
    await clearCachedSession(s, "e1", 2);
    expect(await readCachedSession(s, "e1", 2)).toBeNull();
  });

  it("returns nothing for a corrupt or half-formed entry and never throws on a failing store", async () => {
    const s = memoryStore();
    s.data.set(sessionCacheKey("e1", 5), "[1]");
    expect(await readCachedSession(s, "e1", 5)).toBeNull();
    s.data.set(sessionCacheKey("e1", 6), JSON.stringify({ title: "x" }));
    expect(await readCachedSession(s, "e1", 6)).toBeNull();
    await expect(cacheSession(memoryStore(true), "e1", session)).resolves.toBeUndefined();
  });

  it("holds no diary text: the cache and queue shapes have no field for one", () => {
    expect(Object.keys(session)).not.toContain("diary");
    expect(Object.keys(item(1))).not.toContain("diary");
  });
});
