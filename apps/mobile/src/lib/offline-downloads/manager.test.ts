import { describe, expect, it } from "@jest/globals";
import { createDownloadManager, type DownloadItem, type FilePort, type ManagerDeps } from "./manager";

/** An in-memory file system: path -> bytes. A directory remove deletes every path under it. */
function memoryFiles(opts: { corrupt?: Set<string>; failOn?: Set<string>; status?: Map<string, number> } = {}) {
  const store = new Map<string, { text?: string; bytes: number }>();
  const sizes = new Map<string, number>();
  const calls: string[] = [];
  const port: FilePort = {
    root: "mem://app/",
    ensureDir: async () => undefined,
    readText: async (p) => store.get(p)?.text ?? null,
    writeText: async (p, t) => { store.set(p, { text: t, bytes: t.length }); },
    download: async (url, path) => {
      calls.push(url);
      if (opts.failOn?.has(url)) throw new Error("network");
      const declared = sizes.get(url) ?? 0;
      const bytes = opts.corrupt?.has(url) ? declared + 7 : declared;
      store.set(path, { bytes });
      return { status: opts.status?.get(url) ?? 200, bytes };
    },
    size: async (p) => store.get(p)?.bytes ?? null,
    move: async (a, b) => { const v = store.get(a); if (!v) throw new Error("no file"); store.set(b, v); store.delete(a); },
    remove: async (p) => { for (const k of [...store.keys()]) if (k === p || (p.endsWith("/") && k.startsWith(p))) store.delete(k); },
  };
  return { port, store, sizes, calls };
}

const caps = { wifi_only: true, max_track_bytes: 1000, max_pack_bytes: 2500 };
const item = (id: string, bytes: number, over: Partial<DownloadItem> = {}): DownloadItem => ({ id, bytes, expires_on: "2027-01-01", updated_at: "2026-10-01T00:00:00Z", url: `https://cdn.example/${id}.mp3`, ...over });

function setup(over: Partial<ManagerDeps> = {}, fsOpts = {}, items: DownloadItem[] = []) {
  const fs = memoryFiles(fsOpts);
  for (const i of items) fs.sizes.set(i.url, i.bytes);
  const state = { wifi: true, flag: true, today: "2026-10-07" };
  const m = createDownloadManager({
    namespace: "media", files: fs.port, network: { isOnWifi: async () => state.wifi }, caps,
    today: () => state.today, flagEnabled: async () => state.flag, ...over,
  });
  return { m, fs, state };
}

describe("offline download manager", () => {
  it("downloads a verified item and hands out its file", async () => {
    const a = item("a1", 400);
    const { m, fs } = setup({}, {}, [a]);
    const r = await m.refresh([a]);
    expect(r).toMatchObject({ status: "done", fetched: ["a1"], refused: [] });
    expect(await m.localUri("a1")).toBe("mem://app/media/a1.audio");
    expect(fs.store.has("mem://app/media/a1.audio.part")).toBe(false);
    expect(await m.packBytes()).toBe(400);
  });

  it("does nothing while the feature flag is off, but still deletes expired items", async () => {
    const a = item("a1", 400);
    const { m, fs, state } = setup({}, {}, [a]);
    await m.refresh([a]);
    state.flag = false;
    state.today = "2027-01-01";
    const r = await m.refresh([item("a2", 100)]);
    expect(r).toEqual({ status: "off" });
    expect(fs.calls).toEqual([a.url]);
    expect(await m.localUri("a1")).toBeNull();
    expect(fs.store.has("mem://app/media/a1.audio")).toBe(false);
  });

  it("treats a flag read that throws as off", async () => {
    const a = item("a1", 400);
    const { m, fs } = setup({ flagEnabled: async () => { throw new Error("rpc"); } }, {}, [a]);
    expect(await m.refresh([a])).toEqual({ status: "off" });
    expect(fs.calls).toEqual([]);
  });

  it("is Wi-Fi only: not on Wi-Fi fetches nothing", async () => {
    const a = item("a1", 400), b = item("b1", 300);
    const { m, fs, state } = setup({}, {}, [a, b]);
    state.wifi = false;
    const r = await m.refresh([a, b]);
    expect(r).toMatchObject({ status: "done", fetched: [] });
    expect(fs.calls).toEqual([]);
    expect((r as { refused: unknown[] }).refused).toEqual([{ id: "a1", reason: "not_on_wifi" }]);
  });

  it("an unknown network state (probe throws) is treated as not Wi-Fi", async () => {
    const a = item("a1", 400);
    const { m, fs } = setup({ network: { isOnWifi: async () => { throw new Error("no module"); } } }, {}, [a]);
    await m.refresh([a]);
    expect(fs.calls).toEqual([]);
  });

  it("refuses an item over the per-item cap and stops at the pack cap", async () => {
    const big = item("big", 1001), a = item("a", 900), b = item("b", 900), c = item("c", 900);
    const { m } = setup({}, {}, [big, a, b, c]);
    const r = (await m.refresh([big, a, b, c])) as { fetched: string[]; refused: { id: string; reason: string }[] };
    expect(r.fetched).toEqual(["a", "b"]);
    expect(r.refused).toEqual([{ id: "big", reason: "track_too_large" }, { id: "c", reason: "pack_full" }]);
    expect(await m.packBytes()).toBe(1800);
  });

  it("an update of an item already held does not count the old copy twice", async () => {
    const a = item("a", 900), b = item("b", 900);
    const { m } = setup({}, {}, [a, b]);
    await m.refresh([a, b]);
    const a2 = { ...a, updated_at: "2026-10-05T00:00:00Z" };
    const r = (await m.refresh([a2, b])) as { fetched: string[] };
    expect(r.fetched).toEqual(["a"]);
  });

  it("integrity: a file of the wrong size is deleted, never indexed, never handed out", async () => {
    const a = item("a1", 400);
    const { m, fs } = setup({}, { corrupt: new Set([a.url]) }, [a]);
    const r = (await m.refresh([a])) as { fetched: string[]; refused: { reason: string }[] };
    expect(r.fetched).toEqual([]);
    expect(r.refused[0]?.reason).toBe("bad_file");
    expect(await m.localUri("a1")).toBeNull();
    expect([...fs.store.keys()].filter((k) => k.includes("a1"))).toEqual([]);
  });

  it("integrity: a hash mismatch is refused when the server lists a hash", async () => {
    const a = item("a1", 400, { sha256: "aa".repeat(32) });
    const fs = memoryFiles(); fs.sizes.set(a.url, 400);
    fs.port.sha256 = async () => "bb".repeat(32);
    const m = createDownloadManager({ namespace: "media", files: fs.port, network: { isOnWifi: async () => true }, caps, today: () => "2026-10-07", flagEnabled: async () => true });
    const r = (await m.refresh([a])) as { refused: { reason: string }[] };
    expect(r.refused[0]?.reason).toBe("bad_file");
    expect(await m.localUri("a1")).toBeNull();
  });

  it("an HTTP error or a thrown download leaves nothing behind and the rest still download", async () => {
    const a = item("a", 100), b = item("b", 100), c = item("c", 100);
    const { m, fs } = setup({}, { status: new Map([[a.url, 404]]), failOn: new Set([b.url]) }, [a, b, c]);
    const r = (await m.refresh([a, b, c])) as { fetched: string[]; refused: { id: string; reason: string }[] };
    expect(r.refused).toEqual([{ id: "a", reason: "http_error" }, { id: "b", reason: "download_failed" }]);
    expect(r.fetched).toEqual(["c"]);
    expect([...fs.store.keys()].filter((k) => k.endsWith(".part"))).toEqual([]);
  });

  it("never fetches an item already past its date, and deletes a held one on expiry day even offline", async () => {
    const a = item("a", 100, { expires_on: "2026-10-07" });
    const { m, fs, state } = setup({}, {}, [a]);
    expect(((await m.refresh([a])) as { refused: { reason: string }[] }).refused[0]?.reason).toBe("expired");
    const b = item("b", 100, { expires_on: "2026-10-09" });
    fs.sizes.set(b.url, 100);
    await m.refresh([b]);
    expect(await m.localUri("b")).not.toBeNull();
    state.today = "2026-10-09";
    state.wifi = false;
    expect(await m.localUri("b")).toBeNull();   // not handed out even before the purge has run
    expect(await m.purgeExpired()).toEqual(["b"]);
    expect(await m.localUri("b")).toBeNull();
    expect(fs.store.has("mem://app/media/b.audio")).toBe(false);
  });

  it("a failed manifest read never empties the pack, except for expired items", async () => {
    const a = item("a", 100), b = item("b", 100, { expires_on: "2026-10-08" });
    const { m, state } = setup({}, {}, [a, b]);
    await m.refresh([a, b]);
    state.today = "2026-10-08";
    const r = await m.refresh(null);
    expect(r).toEqual({ status: "kept", reason: "manifest_unavailable", deleted: ["b"] });
    expect(await m.localUri("a")).not.toBeNull();
  });

  it("an item the server stopped listing (withdrawn) is deleted", async () => {
    const a = item("a", 100), b = item("b", 100);
    const { m } = setup({}, {}, [a, b]);
    await m.refresh([a, b]);
    const r = (await m.refresh([b])) as { deleted: string[] };
    expect(r.deleted).toEqual(["a"]);
    expect(await m.localUri("a")).toBeNull();
    expect(await m.localUri("b")).not.toBeNull();
  });

  it("a file that has gone missing or changed size is not handed out", async () => {
    const a = item("a", 100);
    const { m, fs } = setup({}, {}, [a]);
    await m.refresh([a]);
    fs.store.set("mem://app/media/a.audio", { bytes: 99 });
    expect(await m.localUri("a")).toBeNull();
  });

  it("purgeAll deletes everything under the namespace, flag or no flag", async () => {
    const a = item("a", 100);
    const { m, fs, state } = setup({}, {}, [a]);
    await m.refresh([a]);
    state.flag = false;
    await m.purgeAll();
    expect([...fs.store.keys()]).toEqual([]);
    expect(await m.localUri("a")).toBeNull();
  });

  it("refuses ids that could escape the directory", async () => {
    const evil = item("../../x", 100);
    const { m, fs } = setup({}, {}, [evil]);
    const r = (await m.refresh([evil])) as { refused: { reason: string }[] };
    expect(r.refused[0]?.reason).toBe("bad_file");
    expect(fs.calls).toEqual([]);
    expect(await m.localUri("../../x")).toBeNull();
  });

  it("a corrupt index is treated as an empty pack, not a crash", async () => {
    const a = item("a", 100);
    const { m, fs } = setup({}, {}, [a]);
    fs.store.set("mem://app/media/index.json", { text: "{not json", bytes: 9 });
    expect(await m.packBytes()).toBe(0);
    expect((await m.refresh([a]))).toMatchObject({ status: "done", fetched: ["a"] });
  });
});
