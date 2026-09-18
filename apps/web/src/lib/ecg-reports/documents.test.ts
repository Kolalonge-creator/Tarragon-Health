/**
 * loadEcgReportDocuments mirrors lib/lab-results/documents.ts's
 * loadResultDocuments exactly, including the same N+1 signed-URL bug this
 * fixes: one createSignedUrl Storage call per ECG document instead of one
 * batched createSignedUrls call for the whole list. See
 * lib/lab-results/documents.test.ts for the sibling proof.
 */

const createSignedUrls = jest.fn();

jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    storage: {
      from: () => ({
        createSignedUrls,
      }),
    },
  }),
}));

import { loadEcgReportDocuments } from "./documents";
import type { SupabaseClient } from "@supabase/supabase-js";

function fakeSupabase(rows: Array<Record<string, unknown>>) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: rows, error: null }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

function row(id: string, filePath: string) {
  return {
    id,
    source: "patient",
    original_filename: `${id}.pdf`,
    mime_type: "application/pdf",
    note: null,
    created_at: "2026-09-01T00:00:00Z",
    file_path: filePath,
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
  };
}

describe("loadEcgReportDocuments — signed URL batching", () => {
  beforeEach(() => {
    createSignedUrls.mockReset();
  });

  it("mints every ECG document's signed URL in a single Storage call, not one per document", async () => {
    const rows = [row("ecg-1", "patients/p1/a.pdf"), row("ecg-2", "patients/p1/b.pdf")];
    createSignedUrls.mockResolvedValue({
      data: [
        { path: "patients/p1/b.pdf", signedUrl: "https://signed/b" },
        { path: "patients/p1/a.pdf", signedUrl: "https://signed/a" },
      ],
      error: null,
    });

    const documents = await loadEcgReportDocuments(fakeSupabase(rows), "patient-1");

    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(documents.find((d) => d.id === "ecg-1")?.signedUrl).toBe("https://signed/a");
    expect(documents.find((d) => d.id === "ecg-2")?.signedUrl).toBe("https://signed/b");
  });

  it("never calls the Storage API when there are no ECG documents", async () => {
    const documents = await loadEcgReportDocuments(fakeSupabase([]), "patient-1");
    expect(documents).toEqual([]);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("logs a request-level batch failure instead of silently returning every ECG document with a null URL", async () => {
    // Same trade-off as lab-results/documents.ts's sibling test: batching
    // means one bad request now zeroes out every document's signedUrl at
    // once instead of costing just one, so that failure must be logged
    // rather than looking identical to "no ECG documents on file".
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    const rows = [row("ecg-1", "patients/p1/a.pdf"), row("ecg-2", "patients/p1/b.pdf")];
    createSignedUrls.mockResolvedValue({
      data: null,
      error: { message: "storage: service unavailable" },
    });

    const documents = await loadEcgReportDocuments(fakeSupabase(rows), "patient-1");

    expect(documents.every((d) => d.signedUrl === null)).toBe(true);
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
