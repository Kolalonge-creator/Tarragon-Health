import { isDownloaded, listDownloads, purgeExpiredDownloads, removeDownload, saveDownload, syncDownloads, type DownloadableItem } from "./learning-downloads";

const NOW = new Date("2026-10-07T09:00:00Z");

function item(code: string, extra: Partial<DownloadableItem> = {}): DownloadableItem {
  return {
    content_id: `id-${code}`,
    code,
    title: `Title ${code}`,
    summary: null,
    body: `Body of ${code}`,
    content_type: "article",
    estimated_minutes: 3,
    category: "hypertension",
    next_review_due: null,
    ...extra,
  };
}

describe("saving", () => {
  it("saves a servable item and lists it back", async () => {
    expect(await saveDownload("u1", item("a"), NOW)).toEqual({ ok: true });
    expect(await isDownloaded("u1", "a")).toBe(true);
    expect((await listDownloads("u1", NOW)).map((i) => i.code)).toContain("a");
  });

  it("refuses a locked Members item, an empty body and an expired item", async () => {
    expect(await saveDownload("u1", item("m", { locked: true, body: null }), NOW)).toEqual({ ok: false, reason: "locked" });
    expect(await saveDownload("u1", item("e", { body: null }), NOW)).toEqual({ ok: false, reason: "empty" });
    expect(await saveDownload("u1", item("x", { next_review_due: "2026-10-01" }), NOW)).toEqual({ ok: false, reason: "expired" });
    expect(await isDownloaded("u1", "m")).toBe(false);
  });

  it("keeps each person's downloads apart (shared phones)", async () => {
    await saveDownload("u1", item("shared1"), NOW);
    expect(await isDownloaded("u2", "shared1")).toBe(false);
    expect((await listDownloads("u2", NOW)).map((i) => i.code)).not.toContain("shared1");
  });

  it("removes a download", async () => {
    await saveDownload("u1", item("r"), NOW);
    await removeDownload("u1", "r");
    expect(await isDownloaded("u1", "r")).toBe(false);
  });
});

describe("review expiry on a saved item", () => {
  it("hides and deletes a saved item once its review date passes, with no network", async () => {
    await saveDownload("u3", item("soon", { next_review_due: "2026-10-20" }), NOW);
    const later = new Date("2026-10-21T09:00:00Z");
    expect((await listDownloads("u3", later)).map((i) => i.code)).not.toContain("soon");
    expect(await isDownloaded("u3", "soon")).toBe(false);
  });

  it("purgeExpiredDownloads reports how many it removed", async () => {
    await saveDownload("u4", item("p1", { next_review_due: "2026-10-10" }), NOW);
    await saveDownload("u4", item("p2", { next_review_due: "2027-01-10" }), NOW);
    expect(await purgeExpiredDownloads("u4", new Date("2026-10-15T09:00:00Z"))).toBe(1);
    expect(await isDownloaded("u4", "p2")).toBe(true);
  });
});

describe("syncDownloads (the expiry re-check)", () => {
  it("deletes a saved item the server no longer serves, keeps the rest, and refreshes the review date", async () => {
    await saveDownload("u5", item("keep", { next_review_due: "2027-01-01" }), NOW);
    await saveDownload("u5", item("gone", { next_review_due: "2027-01-01" }), NOW);
    const result = await syncDownloads("u5", async () => [{ code: "keep", next_review_due: "2027-06-01" }], NOW);
    expect(result).toEqual({ removed: 1, kept: 1, offline: false });
    expect(await isDownloaded("u5", "gone")).toBe(false);
    expect(await isDownloaded("u5", "keep")).toBe(true);
  });

  it("deletes a saved copy whose content version changed (the text was corrected)", async () => {
    await saveDownload("u8", item("v1", { content_version: 1 }), NOW);
    await saveDownload("u8", item("v2", { content_version: 4 }), NOW);
    const result = await syncDownloads("u8", async () => [{ code: "v1", next_review_due: null, content_version: 2 }, { code: "v2", next_review_due: null, content_version: 4 }], NOW);
    expect(result).toEqual({ removed: 1, kept: 1, offline: false });
    expect(await isDownloaded("u8", "v1")).toBe(false);
    expect(await isDownloaded("u8", "v2")).toBe(true);
  });

  it("deletes everything when the server returns nothing (all withdrawn)", async () => {
    await saveDownload("u6", item("w1"), NOW);
    const result = await syncDownloads("u6", async () => [], NOW);
    expect(result.removed).toBe(1);
    expect(await isDownloaded("u6", "w1")).toBe(false);
  });

  it("offline: only the local review-date rule applies and nothing else is deleted", async () => {
    await saveDownload("u7", item("o1", { next_review_due: "2026-10-09" }), NOW);
    await saveDownload("u7", item("o2", { next_review_due: "2027-02-01" }), NOW);
    const result = await syncDownloads("u7", async () => null, new Date("2026-10-12T09:00:00Z"));
    expect(result).toEqual({ removed: 1, kept: 1, offline: true });
    expect(await isDownloaded("u7", "o2")).toBe(true);
  });
});
