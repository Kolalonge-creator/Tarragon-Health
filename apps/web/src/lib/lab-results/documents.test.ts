/**
 * P10: the result page's loaders tell a failed read apart from "not there", so the page never says "not found" or "this is
 * the first one" when it simply could not check.
 */
jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase/sign-storage-paths", () => ({
  signStoragePaths: async (_bucket: string, paths: string[]) => new Map(paths.map((p) => [p, `https://signed/${p}`])),
}));

import { loadEarlierResultDocuments, loadResultDocument } from "./documents";

const filters: unknown[][] = [];
beforeEach(() => (filters.length = 0));

function supabaseReturning(result: { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) b[m] = () => b;
  b.is = (...args: unknown[]) => (filters.push(["is", ...args]), b);
  b.lt = (...args: unknown[]) => (filters.push(["lt", ...args]), b);
  b.maybeSingle = async () => result;
  b.limit = async () => result;
  return { from: () => b } as never;
}

describe("loadResultDocument", () => {
  it("reports a failed read as a failure, not as missing", async () => {
    expect(await loadResultDocument(supabaseReturning({ data: null, error: { message: "boom" } }), "p1", "d1")).toEqual({ ok: false });
  });

  it("returns null when the document is not visible", async () => {
    expect(await loadResultDocument(supabaseReturning({ data: null, error: null }), "p1", "d1")).toEqual({ ok: true, doc: null });
  });

  it("returns the document with a signed link to the original", async () => {
    const row = { id: "d1", file_path: "p1/a.pdf", mime_type: "application/pdf", ai_flagged_analytes: null, created_at: "2026-11-01T10:00:00Z" };
    const loaded = await loadResultDocument(supabaseReturning({ data: row, error: null }), "p1", "d1");
    expect(loaded.ok && loaded.doc?.signedUrl).toBe("https://signed/p1/a.pdf");
    expect(loaded.ok && loaded.doc?.isPdf).toBe(true);
  });
});

describe("loadEarlierResultDocuments", () => {
  it("returns null on a failed read and marks only explained results as interpreted", async () => {
    expect(await loadEarlierResultDocuments(supabaseReturning({ data: null, error: { message: "boom" } }), "p1", "hba1c", "2026-11-06T12:00:00.000Z")).toBeNull();
    const rows = [
      { id: "a", created_at: "1", interpretation_sent_at: "t", patient_interpretation: "Fine" },
      { id: "b", created_at: "2", interpretation_sent_at: "t", patient_interpretation: null },
    ];
    const earlier = await loadEarlierResultDocuments(supabaseReturning({ data: rows, error: null }), "p1", "hba1c", "2026-11-06T12:00:00.000Z");
    expect(earlier?.map((r) => r.interpreted)).toEqual([true, false]);
  });

  it("skips the other pages of the same send and copies a correction has replaced", async () => {
    await loadEarlierResultDocuments(supabaseReturning({ data: [], error: null }), "p1", "hba1c", "2026-11-06T12:00:00.000Z");
    expect(filters).toContainEqual(["is", "superseded_by_document_id", null]);
    expect(filters).toContainEqual(["lt", "created_at", "2026-11-06T11:00:00.000Z"]);
  });
});
