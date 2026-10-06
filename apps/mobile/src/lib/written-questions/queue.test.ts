import { createWrittenQuestionQueue, type QueuedItem, type QueueRemote, type QueueStore, type RemoteFailure } from "./queue";

/** In-memory stores: the queue logic is pure, so storage and network are faked here. */
function fakeStore() {
  const items = new Map<string, QueuedItem>();
  const photos = new Map<string, Uint8Array>();
  const store: QueueStore = {
    async insert(item, bytes) {
      items.set(item.clientId, item);
      for (const p of bytes) photos.set(`${item.clientId}/${p.id}`, p.bytes);
    },
    async update(item) {
      items.set(item.clientId, item);
    },
    async list(userId) {
      return [...items.values()].filter((i) => i.userId === userId);
    },
    async loadPhoto(clientId, photoId) {
      return photos.get(`${clientId}/${photoId}`) ?? null;
    },
    async remove(clientId) {
      items.delete(clientId);
      for (const key of [...photos.keys()]) if (key.startsWith(`${clientId}/`)) photos.delete(key);
    },
  };
  return { store, items, photos };
}

type Calls = { submit: string[]; upload: string[]; register: string[] };

function fakeRemote(overrides: Partial<QueueRemote> = {}) {
  const calls: Calls = { submit: [], upload: [], register: [] };
  const remote: QueueRemote = {
    async submit(input) {
      calls.submit.push(input.clientId);
      return { ok: true, id: `consult-${input.clientId}` };
    },
    async upload(path) {
      calls.upload.push(path);
      return { ok: true };
    },
    async register(_consultId, path) {
      calls.register.push(path);
      return { ok: true };
    },
    ...overrides,
  };
  return { remote, calls };
}

function build(overrides: Partial<QueueRemote> = {}, start = 1_000_000) {
  const { store, items, photos } = fakeStore();
  const { remote, calls } = fakeRemote(overrides);
  let clock = start;
  let n = 0;
  const queue = createWrittenQuestionQueue({ store, remote, now: () => clock, newId: () => `id-${(n += 1)}` });
  return { queue, items, photos, calls, advance: (ms: number) => { clock += ms; }, setRemote: (r: Partial<QueueRemote>) => Object.assign(remote, r) };
}

const input = { category: "symptom" as const, question: "  My knee is swollen.  ", durationNote: " two days ", photos: [{ bytes: new Uint8Array([1, 2, 3]) }] };

describe("written question queue", () => {
  it("writes the item and its photo bytes before anything is sent, trimmed", async () => {
    const { queue, items, photos, calls } = build();
    const item = await queue.enqueue("user-a", input);
    expect(items.get(item.clientId)?.question).toBe("My knee is swollen.");
    expect(items.get(item.clientId)?.durationNote).toBe("two days");
    expect(photos.size).toBe(1);
    expect(calls.submit).toEqual([]);
    expect(item.state).toBe("queued");
  });

  it("flushes a queued item: submit, upload, register, then removes everything", async () => {
    const { queue, items, photos, calls } = build();
    const item = await queue.enqueue("user-a", input);
    const summary = await queue.flush("user-a");
    expect(summary).toEqual({ sent: 1, returned: 0, waiting: 0, failed: false });
    expect(calls.submit).toEqual([item.clientId]);
    expect(calls.upload).toHaveLength(1);
    expect(calls.upload[0]).toMatch(/^user-a\/consult-id-\d+\//);
    expect(calls.register).toEqual(calls.upload);
    expect(items.size).toBe(0);
    expect(photos.size).toBe(0);
  });

  it("resumes after an interruption without a second submit and without re-uploading a finished photo", async () => {
    const { queue, items, calls, setRemote, advance } = build();
    const item = await queue.enqueue("user-a", { ...input, photos: [{ bytes: new Uint8Array([1]) }, { bytes: new Uint8Array([2]) }] });
    // the second photo's upload fails: the question and the first photo are already done
    let uploads = 0;
    setRemote({
      async upload(path) {
        uploads += 1;
        calls.upload.push(path);
        return uploads === 2 ? { ok: false } : { ok: true };
      },
    });
    const first = await queue.flush("user-a");
    expect(first.failed).toBe(true);
    const mid = items.get(item.clientId);
    expect(mid?.consultId).toBe(`consult-${item.clientId}`);
    expect(mid?.photos.map((p) => [p.uploaded, p.registered])).toEqual([[true, true], [false, false]]);
    expect(mid?.attempts).toBe(1);

    advance(10 * 60 * 1000);
    setRemote({ async upload(path) { calls.upload.push(path); return { ok: true }; } });
    const second = await queue.flush("user-a");
    expect(second.sent).toBe(1);
    expect(calls.submit).toEqual([item.clientId]); // still one submit
    expect(calls.upload).toHaveLength(3); // photo 1 once, photo 2 twice (failed, then done)
    expect(items.size).toBe(0);
  });

  it("keeps the item and backs off on a network failure, and ignores the back-off when forced", async () => {
    const { queue, items, calls, setRemote, advance } = build({
      async submit() {
        return { ok: false, final: false, key: "wq.error.generic", message: "network down" } satisfies RemoteFailure;
      },
    });
    const item = await queue.enqueue("user-a", input);
    const first = await queue.flush("user-a");
    expect(first).toEqual({ sent: 0, returned: 0, waiting: 1, failed: true });
    const kept = items.get(item.clientId);
    expect(kept?.attempts).toBe(1);
    expect(kept?.lastError).toBe("network down");
    expect(kept?.nextAttemptAt ?? 0).toBeGreaterThan(1_000_000);

    // not yet due: nothing is tried
    setRemote({ async submit(i) { calls.submit.push(i.clientId); return { ok: true, id: "c1" }; } });
    const early = await queue.flush("user-a");
    expect(early).toEqual({ sent: 0, returned: 0, waiting: 1, failed: false });
    expect(calls.submit).toEqual([]);

    // forced (foreground, sign-in, a manual pull) ignores the wait
    const forced = await queue.flush("user-a", { force: true });
    expect(forced.sent).toBe(1);
    advance(0);
    expect(items.size).toBe(0);
  });

  it.each([
    ["wq.members_only"],
    ["wq.adults_only"],
    ["wq.allowance.none"],
  ] as const)("a final refusal (%s) returns the text instead of retrying or deleting it", async (key) => {
    const { queue, items, photos, calls } = build({
      async submit() {
        return { ok: false, final: true, key, message: "refused" } satisfies RemoteFailure;
      },
    });
    const item = await queue.enqueue("user-a", input);
    const summary = await queue.flush("user-a");
    expect(summary).toEqual({ sent: 0, returned: 1, waiting: 0, failed: false });
    const kept = items.get(item.clientId);
    expect(kept?.state).toBe("returned");
    expect(kept?.returnedKey).toBe(key);
    expect(kept?.question).toBe("My knee is swollen.");
    expect(photos.size).toBe(1); // the photos wait with it
    expect(calls.upload).toEqual([]);
    // a returned item is never sent again
    await queue.flush("user-a", { force: true });
    expect(calls.submit).toEqual([]);
  });

  it("a refused photo is dropped and the question is kept and sent", async () => {
    const { queue, items } = build({ async register() { return { ok: false, dropPhoto: true }; } });
    const item = await queue.enqueue("user-a", input);
    const summary = await queue.flush("user-a");
    expect(summary.sent).toBe(1);
    expect(items.has(item.clientId)).toBe(false);
  });

  it("a photo whose bytes are missing is dropped without blocking the question", async () => {
    const { queue, items, photos, calls } = build();
    const item = await queue.enqueue("user-a", input);
    photos.clear();
    const summary = await queue.flush("user-a");
    expect(summary.sent).toBe(1);
    expect(calls.upload).toEqual([]);
    expect(items.has(item.clientId)).toBe(false);
  });

  it("a thrown error is a retryable failure, never a lost item", async () => {
    const { queue, items } = build({ async submit() { throw new Error("socket closed"); } });
    const item = await queue.enqueue("user-a", input);
    const summary = await queue.flush("user-a");
    expect(summary.failed).toBe(true);
    expect(items.get(item.clientId)?.lastError).toBe("socket closed");
    expect(items.get(item.clientId)?.state).toBe("queued");
  });

  it("two flushes at once share one run", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const submit: string[] = [];
    const { queue } = build({
      async submit(i) {
        submit.push(i.clientId);
        await gate;
        return { ok: true, id: "c1" };
      },
    });
    await queue.enqueue("user-a", { ...input, photos: [] });
    const a = queue.flush("user-a");
    const b = queue.flush("user-a");
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(submit).toHaveLength(1);
    expect(ra).toBe(rb);
    expect(ra.sent).toBe(1);
  });

  it("keeps each patient's items apart: another account's items are never listed, sent or discarded", async () => {
    const { queue, items, calls } = build();
    const a = await queue.enqueue("user-a", { ...input, photos: [] });
    const b = await queue.enqueue("user-b", { ...input, photos: [] });
    expect((await queue.list("user-a")).map((i) => i.clientId)).toEqual([a.clientId]);
    expect(await queue.discard("user-a", b.clientId)).toBe(false);
    expect(items.has(b.clientId)).toBe(true);
    await queue.flush("user-a");
    expect(calls.submit).toEqual([a.clientId]);
    expect(items.has(b.clientId)).toBe(true);
  });

  it("discard removes an item and its photos", async () => {
    const { queue, items, photos } = build();
    const item = await queue.enqueue("user-a", input);
    expect(await queue.discard("user-a", item.clientId)).toBe(true);
    expect(items.size).toBe(0);
    expect(photos.size).toBe(0);
    expect(await queue.discard("user-a", item.clientId)).toBe(false);
  });

  it("sends items in the order they were written and stops at the first retryable failure", async () => {
    const order: string[] = [];
    let failFirst = true;
    const { queue, items } = build({
      async submit(i) {
        order.push(i.question);
        if (failFirst) return { ok: false, final: false, key: "wq.error.generic" } satisfies RemoteFailure;
        return { ok: true, id: "c" + order.length };
      },
    });
    const first = await queue.enqueue("user-a", { ...input, question: "first question here", photos: [] });
    await queue.enqueue("user-a", { ...input, question: "second question here", photos: [] });
    const s1 = await queue.flush("user-a");
    expect(order).toEqual(["first question here"]); // the second is not hammered
    expect(s1.waiting).toBe(2);
    failFirst = false;
    const s2 = await queue.flush("user-a", { force: true });
    expect(s2.sent).toBe(2);
    expect(order.slice(1)).toEqual(["first question here", "second question here"]);
    expect(items.has(first.clientId)).toBe(false);
  });

  it("the photo path is the patient's own folder for the server's consult id", async () => {
    const { queue, calls } = build();
    await queue.enqueue("user-a", input);
    await queue.flush("user-a");
    const parts = (calls.upload[0] ?? "").split("/");
    expect(parts[0]).toBe("user-a");
    expect(parts[1]).toMatch(/^consult-/);
    expect(parts[2]).toMatch(/\.jpg$/);
  });
});
