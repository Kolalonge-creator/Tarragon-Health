import { describe, expect, it, jest } from "@jest/globals";

jest.mock("expo-sqlite", () => ({}));
jest.mock("@react-native-async-storage/async-storage", () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn() } }));
jest.mock("./supabase", () => ({ supabase: {} }));
jest.mock("./audio/manifest", () => ({ audioCatalogue: () => null }));

import {
  autoRefreshDue,
  pickOfflineDailyLesson,
  purgeExpired,
  readOffline,
  refreshPack,
  searchOffline,
  type PackApi,
  type PackStore,
  type StoredLesson,
} from "./learning-pack";
import { sharedArticleUrl, type PackRow } from "./learning-centre";

const NOW = new Date("2026-10-07T12:00:00Z");
const CFG = { max_total_bytes: 1000, max_items: 10, audio_wifi_only: true };

class MemoryStore implements PackStore {
  items = new Map<string, StoredLesson>();
  async list() { return [...this.items.values()]; }
  async put(items: StoredLesson[]) { for (const i of items) this.items.set(i.code, i); }
  async remove(codes: string[]) { for (const c of codes) this.items.delete(c); }
  async clear() { this.items.clear(); }
}

const stored = (code: string, over: Partial<StoredLesson> = {}): StoredLesson => ({
  code, contentVersion: 1, title: `T ${code}`, summary: null, body: "b", category: "hypertension", estimatedMinutes: 3, isMicroLesson: false,
  lessonAction: null, selfCareAction: null, knowledgeCheck: null, audioClipId: null, reviewedByName: "Dr A", reviewedAt: "2026-09-01T00:00:00Z",
  nextReviewDue: "2027-01-01", sourceReference: "WHO", creatorName: null, textBytes: 100, withAudio: false, downloadedAt: NOW.toISOString(), ...over,
});
const row = (code: string, over: Partial<PackRow> = {}): PackRow => ({
  code, content_version: 1, title: `T ${code}`, summary: null, body: "b", category: "hypertension", content_type: "article", estimated_minutes: 3,
  is_micro_lesson: false, lesson_action: null, self_care_action: null, knowledge_check: null, audio_clip_id: null, reviewed_by_name: "Dr A",
  reviewed_at: "2026-09-01T00:00:00Z", next_review_due: "2027-01-01", source_reference: "WHO", creator_name: null, text_bytes: 100, ...over,
}) as PackRow;

describe("offline reads never show an expired lesson", () => {
  it("hides a lesson on its review date even with no network, and purges it locally", async () => {
    const store = new MemoryStore();
    await store.put([stored("fresh"), stored("due-today", { nextReviewDue: "2026-10-07" }), stored("old", { nextReviewDue: "2026-09-30" })]);
    expect((await readOffline(store, NOW)).map((l) => l.code)).toEqual(["fresh"]);
    expect(await purgeExpired(store, NOW)).toEqual(["due-today", "old"]);
    expect([...store.items.keys()]).toEqual(["fresh"]);
  });
});

describe("refresh on reconnect", () => {
  it("removes what the server no longer serves, re-fetches a changed item and adds a new one", async () => {
    const store = new MemoryStore();
    await store.put([stored("keep"), stored("withdrawn"), stored("changed")]);
    const api: PackApi = {
      fetchStatus: async () => [
        { code: "keep", servable: true, content_version: 1, next_review_due: "2027-01-01" },
        { code: "withdrawn", servable: false, content_version: 1, next_review_due: "2026-09-01" },
        { code: "changed", servable: true, content_version: 2, next_review_due: "2027-01-01" },
      ],
      fetchPack: async () => [row("keep"), row("changed", { content_version: 2, title: "New title" }), row("fresh")],
    };
    const res = await refreshPack({ store, api, config: CFG, now: NOW });
    expect(res).toMatchObject({ ok: true, added: 1, refreshed: 1 });
    expect(store.items.has("withdrawn")).toBe(false);
    expect(store.items.get("changed")?.title).toBe("New title");
    expect(store.items.get("changed")?.contentVersion).toBe(2);
    expect(store.items.has("fresh")).toBe(true);
  });

  it("a failed refresh empties nothing; only locally expired items go", async () => {
    const store = new MemoryStore();
    await store.put([stored("keep"), stored("expired", { nextReviewDue: "2026-10-01" })]);
    const api: PackApi = { fetchStatus: async () => { throw new Error("offline"); }, fetchPack: async () => { throw new Error("offline"); } };
    const res = await refreshPack({ store, api, config: CFG, now: NOW });
    expect(res.ok).toBe(false);
    expect([...store.items.keys()]).toEqual(["keep"]);
  });

  it("a refresh that cannot write the new pack keeps the lessons already saved", async () => {
    const store = new MemoryStore();
    await store.put([stored("old-a"), stored("old-b")]);
    const failing: PackStore = {
      list: () => store.list(),
      put: async () => { throw new Error("disk full"); },
      remove: (codes) => store.remove(codes),
      clear: () => store.clear(),
    };
    const api: PackApi = {
      fetchStatus: async () => [
        { code: "old-a", servable: true, content_version: 1, next_review_due: "2027-01-01" },
        { code: "old-b", servable: true, content_version: 1, next_review_due: "2027-01-01" },
      ],
      fetchPack: async () => [row("brand-new")],
    };
    const res = await refreshPack({ store: failing, api, config: CFG, now: NOW });
    expect(res.ok).toBe(false);
    expect([...store.items.keys()].sort()).toEqual(["old-a", "old-b"]);
  });

  it("never downloads an expired or over-cap item, and drops one that no longer fits", async () => {
    const store = new MemoryStore();
    await store.put([stored("was-fine", { textBytes: 100 })]);
    const api: PackApi = {
      fetchStatus: async () => [{ code: "was-fine", servable: true, content_version: 1, next_review_due: "2027-01-01" }],
      fetchPack: async () => [
        row("expired-on-server-list", { next_review_due: "2026-10-01" }),
        row("big", { text_bytes: 900 }),
        row("big2", { text_bytes: 900 }),
      ],
    };
    const res = await refreshPack({ store, api, config: CFG, now: NOW });
    expect(res.ok).toBe(true);
    expect([...store.items.keys()]).toEqual(["big"]);
    expect(res.totalBytes).toBeLessThanOrEqual(CFG.max_total_bytes);
  });

  it("keeps text but drops audio that would break the cap", async () => {
    const store = new MemoryStore();
    const api: PackApi = {
      fetchStatus: async () => [],
      fetchPack: async () => [row("a", { audio_clip_id: "LSN-001", text_bytes: 100 }), row("b", { audio_clip_id: "LSN-002", text_bytes: 100 })],
    };
    await refreshPack({ store, api, config: CFG, audioBytes: (id) => (id === "LSN-001" ? 500 : 5000), now: NOW });
    expect(store.items.get("a")?.withAudio).toBe(true);
    expect(store.items.get("b")?.withAudio).toBe(false);
  });
});

describe("downloads on the phone", () => {
  it("offers the first in-date micro-lesson as today's lesson when offline", () => {
    const items = [stored("art"), stored("m-old", { isMicroLesson: true, nextReviewDue: "2026-10-01" }), stored("m-ok", { isMicroLesson: true })];
    expect(pickOfflineDailyLesson(items, NOW)?.code).toBe("m-ok");
    expect(pickOfflineDailyLesson([stored("art")], NOW)).toBeNull();
  });
  it("searches the downloads with the synonym table", () => {
    const items = [stored("a", { title: "Living with hypertension" }), stored("b", { title: "Eating well" })];
    expect(searchOffline(items, "BP").map((i) => i.code)).toEqual(["a"]);
  });
});

describe("shared link", () => {
  it("points at the public site with the content code only", () => {
    expect(sharedArticleUrl("htn-basics", "https://app.tarragonhealth.ng")).toBe("https://tarragonhealth.ng/learn/htn-basics");
    expect(sharedArticleUrl("a b", "https://app.tarragonhealth.ng/")).toBe("https://tarragonhealth.ng/learn/a%20b");
  });
});

describe("automatic refresh throttle", () => {
  it("refreshes when never refreshed or long ago, not on every return to the app", () => {
    expect(autoRefreshDue(null, NOW)).toBe(true);
    expect(autoRefreshDue("garbage", NOW)).toBe(true);
    expect(autoRefreshDue("2026-10-07T11:00:00Z", NOW)).toBe(false);
    expect(autoRefreshDue("2026-10-07T05:00:00Z", NOW)).toBe(true);
  });
});
