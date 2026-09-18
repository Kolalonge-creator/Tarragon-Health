/**
 * loadResultDocuments used to mint each document's signed URL with its own
 * Storage API round trip (Promise.all(rows.map(async (row) => ... createSignedUrl))),
 * so a patient (or an org's clinician view) with N result documents fired N
 * separate signed-URL requests on every page load — a real N+1, not just a
 * scale concern, on both the patient dashboard and the clinician patient
 * detail page that both call this function. This proves the fix: one batched
 * createSignedUrls call regardless of row count, with each document still
 * getting the right URL back even when the storage API returns them in a
 * different order than requested.
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

import { loadResultDocuments } from "./documents";
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
    test_code: null,
    created_at: "2026-09-01T00:00:00Z",
    file_path: filePath,
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
    patient_interpretation: null,
    next_steps: null,
    interpretation_sent_at: null,
    acknowledgement_status: "new",
    action_completed_at: null,
    ai_summary_status: "not_applicable",
    ai_summary_generated_at: null,
    supersedes_document_id: null,
    superseded_by_document_id: null,
    superseded_at: null,
  };
}

describe("loadResultDocuments — signed URL batching", () => {
  beforeEach(() => {
    createSignedUrls.mockReset();
  });

  it("mints every document's signed URL in a single Storage call, not one per document", async () => {
    const rows = [row("doc-1", "patients/p1/a.pdf"), row("doc-2", "patients/p1/b.pdf"), row("doc-3", "patients/p1/c.pdf")];
    // Deliberately returned out of request order — a naive index-based
    // zip would silently mis-attribute URLs to the wrong document.
    createSignedUrls.mockResolvedValue({
      data: [
        { path: "patients/p1/c.pdf", signedUrl: "https://signed/c" },
        { path: "patients/p1/a.pdf", signedUrl: "https://signed/a" },
        { path: "patients/p1/b.pdf", signedUrl: "https://signed/b" },
      ],
      error: null,
    });

    const documents = await loadResultDocuments(fakeSupabase(rows), "patient-1");

    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith(
      ["patients/p1/a.pdf", "patients/p1/b.pdf", "patients/p1/c.pdf"],
      300,
    );
    expect(documents.find((d) => d.id === "doc-1")?.signedUrl).toBe("https://signed/a");
    expect(documents.find((d) => d.id === "doc-2")?.signedUrl).toBe("https://signed/b");
    expect(documents.find((d) => d.id === "doc-3")?.signedUrl).toBe("https://signed/c");
  });

  it("never calls the Storage API at all when there are no documents", async () => {
    const documents = await loadResultDocuments(fakeSupabase([]), "patient-1");
    expect(documents).toEqual([]);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("falls a document back to a null signedUrl if the batch response omits its path, instead of throwing", async () => {
    const rows = [row("doc-1", "patients/p1/a.pdf")];
    createSignedUrls.mockResolvedValue({ data: [], error: null });

    const documents = await loadResultDocuments(fakeSupabase(rows), "patient-1");

    expect(documents[0].signedUrl).toBeNull();
  });
});
