import { describe, expect, it } from "@jest/globals";
import { buildNextStep, buildTrustLine, expandSearchTerms, isExpired, lagosToday, normaliseQuery, planOfflinePack, reconcilePack, searchLocal } from "./index";

const cfg = { max_total_bytes: 1000, max_items: 3, audio_wifi_only: true };
const NOW = new Date("2026-10-07T12:00:00Z");

describe("search synonyms", () => {
  it("normalises like the database", () => {
    expect(normaliseQuery("  High-BLOOD!! ")).toBe("high blood");
  });
  it("expands BP, sugar, belle and high blood from the configured table", () => {
    expect(expandSearchTerms("BP")).toEqual(expect.arrayContaining(["blood pressure", "hypertension"]));
    expect(expandSearchTerms("sugar")).toEqual(expect.arrayContaining(["diabetes", "glucose"]));
    expect(expandSearchTerms("belle")).toEqual(expect.arrayContaining(["pregnancy", "antenatal"]));
    expect(expandSearchTerms("my high blood")).toEqual(expect.arrayContaining(["hypertension"]));
  });
  it("does not match inside a word and never says one condition is another", () => {
    expect(expandSearchTerms("bpm")).toEqual(["bpm"]);
    expect(expandSearchTerms("sugar")).not.toContain("hypertension");
  });
  it("picks the longest non-overlapping match, so one ambiguous word does not pull in another condition", () => {
    const hs = expandSearchTerms("high blood sugar");
    expect(hs).toEqual(expect.arrayContaining(["diabetes", "glucose"]));
    expect(hs).not.toContain("hypertension");
    expect(expandSearchTerms("insulin injection")).not.toContain("vaccine");
    expect(expandSearchTerms("high blood")).toContain("hypertension");
  });
  it("is empty for a one-letter query", () => expect(expandSearchTerms("a")).toEqual([]));
  it("finds a body-only match through a synonym and ranks title above body", () => {
    const items = [
      { title: "Daily habits", body: "Living with hypertension" },
      { title: "Understanding blood pressure", body: "" },
    ];
    expect(searchLocal(items, "BP").map((i) => i.title)).toEqual(["Understanding blood pressure", "Daily habits"]);
    expect(searchLocal(items, "football")).toEqual([]);
  });
});

describe("offline expiry (the F1 rule on the phone)", () => {
  it("uses the Lagos calendar day", () => {
    expect(lagosToday(new Date("2026-10-07T23:30:00Z"))).toBe("2026-10-08");
  });
  it("expires on the review date, not after", () => {
    expect(isExpired({ nextReviewDue: "2026-10-07" }, NOW)).toBe(true);
    expect(isExpired({ nextReviewDue: "2026-10-08" }, NOW)).toBe(false);
    expect(isExpired({ nextReviewDue: null }, NOW)).toBe(false);
    expect(isExpired({ status: "review_due", nextReviewDue: "2030-01-01" }, NOW)).toBe(true);
  });
});

describe("offline pack plan", () => {
  const item = (code: string, bytes: number, over: Partial<{ audio: string | null; due: string | null }> = {}) => ({
    code, contentVersion: 1, textBytes: bytes, audioClipId: over.audio ?? null, nextReviewDue: over.due ?? "2027-01-01",
  });
  it("never includes an expired item", () => {
    const plan = planOfflinePack([item("a", 10, { due: "2026-10-01" }), item("b", 10)], cfg, () => null, NOW);
    expect(plan.chosen.map((c) => c.item.code)).toEqual(["b"]);
    expect(plan.skippedExpired).toEqual(["a"]);
  });
  it("respects the byte cap and the item cap", () => {
    const plan = planOfflinePack([item("a", 600), item("b", 600), item("c", 100), item("d", 100), item("e", 100)], cfg, () => null, NOW);
    expect(plan.chosen.map((c) => c.item.code)).toEqual(["a", "c", "d"]);
    expect(plan.skippedOverCap).toEqual(["b", "e"]);
    expect(plan.totalBytes).toBe(800);
  });
  it("keeps the text but drops audio that would not fit, and counts audio that does", () => {
    const sizes: Record<string, number> = { "TH-1": 300, "TH-2": 900 };
    const plan = planOfflinePack([item("a", 100, { audio: "TH-1" }), item("b", 100, { audio: "TH-2" })], cfg, (id) => sizes[id] ?? null, NOW);
    expect(plan.chosen.map((c) => [c.item.code, c.withAudio])).toEqual([["a", true], ["b", false]]);
    expect(plan.totalBytes).toBe(500);
  });
});

describe("pack refresh on reconnect", () => {
  it("removes what the server no longer serves, refreshes what changed, keeps the rest", () => {
    const out = reconcilePack(
      [{ code: "a", contentVersion: 1 }, { code: "b", contentVersion: 1 }, { code: "c", contentVersion: 1 }, { code: "d", contentVersion: 2 }],
      [{ code: "a", servable: false, contentVersion: 1 }, { code: "b", servable: true, contentVersion: 2 }, { code: "d", servable: true, contentVersion: 2 }],
    );
    expect(out.remove).toEqual(["a", "c"]);
    expect(out.refresh).toEqual(["b"]);
  });
});

describe("What can I do next? and the trust line", () => {
  it("always carries ask, book and emergency; self-care only when authored", () => {
    expect(buildNextStep("Walk ten minutes").map((a) => a.kind)).toEqual(["self_care", "ask_care_team", "book", "emergency"]);
    expect(buildNextStep("  ").map((a) => a.kind)).toEqual(["ask_care_team", "book", "emergency"]);
    expect(buildNextStep(null).at(-1)?.kind).toBe("emergency");
  });
  it("shows reviewer, review date and sources, and flags what is missing instead of inventing it", () => {
    const full = buildTrustLine({ reviewedByName: "Dr A", reviewedAt: "2026-09-01T10:00:00Z", sourceReference: "WHO 2021", nextReviewDue: "2027-09-01" });
    expect(full).toMatchObject({ reviewedBy: "Dr A", reviewedOn: "2026-09-01", sources: "WHO 2021", incomplete: false });
    expect(buildTrustLine({ reviewedByName: "Dr A" }).incomplete).toBe(true);
    expect(buildTrustLine({}).reviewedBy).toBeNull();
  });
});
