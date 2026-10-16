/**
 * The reading run for photo capture (S43, spec 2.3, AI-018).
 *
 * Proves, against the real runDocumentCapture: the only table it touches is
 * patient_documents (so an unconfirmed value cannot reach medications, vitals,
 * labs, alerts or risk from here), the only write is record_document_suggestion,
 * a failed or unreadable reading is recorded as failed and holds nothing, a
 * closed guard stores nothing, and the model call goes through the governed
 * wrapper with the registered system code.
 */

const runGovernedAi = jest.fn();
jest.mock("@/lib/ai-governance", () => ({
  AI_SYSTEMS: { documentCapture: { code: "AI-018" } },
  runGovernedAi: (params: unknown) => runGovernedAi(params),
}));
jest.mock("@/lib/lab-reports/heic", () => ({
  isReadableDocumentType: (t: string | null) => t === "image/jpeg" || t === "image/png" || t === "application/pdf",
  normaliseForVision: async (buf: Buffer, type: string) => ({ buffer: buf, mediaType: type, converted: false }),
}));

import { runDocumentCapture } from "./run";
import type { DocumentCaptureResult } from "./extract";

type Doc = { id: string; patient_id: string; document_type: string; file_path: string; ocr_state: string | null };

function makeService(opts: { doc?: Doc | null; fileType?: string; downloadError?: boolean; rpcError?: { code: string; message: string } | null } = {}) {
  const tables: string[] = [];
  const rpc = jest.fn(async () => ({ data: null, error: opts.rpcError ?? null }));
  const doc: Doc | null = opts.doc === undefined ? { id: "d1", patient_id: "p1", document_type: "prescription", file_path: "p1/a.jpg", ocr_state: "pending" } : opts.doc;
  const service = {
    from: (table: string) => {
      tables.push(table);
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: doc }) }) }) };
    },
    storage: {
      from: () => ({
        download: async () =>
          opts.downloadError
            ? { data: null, error: new Error("missing") }
            : { data: { type: opts.fileType ?? "image/jpeg", arrayBuffer: async () => new ArrayBuffer(8) }, error: null },
      }),
    },
    rpc,
  };
  return { service: service as never, tables, rpc };
}

const SUGGESTED: DocumentCaptureResult = {
  ok: true,
  suggestions: {
    ocrText: "Metformin 500mg",
    fields: [{ key: "medicine", label: "Medicine", value: "Metformin 500mg", unit: null, confidence: "high" }],
    unreadableReason: null,
  },
};

beforeEach(() => {
  runGovernedAi.mockReset();
  // Behave like the real wrapper on the happy path: run the AI path and hand back its value.
  runGovernedAi.mockImplementation(async (p: { run: () => Promise<{ value: unknown }> }) => ({ value: (await p.run()).value }));
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("runDocumentCapture", () => {
  it("records suggestions through record_document_suggestion and touches no other table", async () => {
    const { service, tables, rpc } = makeService();
    const out = await runDocumentCapture(service, "d1", { extract: async () => SUGGESTED });
    expect(out).toMatchObject({ status: "suggested", fieldCount: 1 });
    expect(new Set(tables)).toEqual(new Set(["patient_documents"]));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "record_document_suggestion",
      expect.objectContaining({ p_document: "d1", p_failed: false, p_extracted: expect.objectContaining({ fields: expect.any(Array) }) })
    );
  });

  it("goes through the governed wrapper under the registered system code and subject", async () => {
    const { service } = makeService();
    await runDocumentCapture(service, "d1", { extract: async () => SUGGESTED });
    expect(runGovernedAi).toHaveBeenCalledWith(expect.objectContaining({ systemCode: "AI-018", subjectProfileId: "p1", inputCategory: "patient_document_photo" }));
  });

  it("does nothing for a document that is not waiting for a reading", async () => {
    const { service, rpc } = makeService({ doc: { id: "d1", patient_id: "p1", document_type: "other", file_path: "p1/a.jpg", ocr_state: "confirmed" } });
    const extract = jest.fn();
    expect(await runDocumentCapture(service, "d1", { extract })).toMatchObject({ status: "not_pending" });
    expect(extract).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(runGovernedAi).not.toHaveBeenCalled();
  });

  it("does nothing for a document that does not exist", async () => {
    const { service, rpc } = makeService({ doc: null });
    expect(await runDocumentCapture(service, "nope", { extract: jest.fn() })).toMatchObject({ status: "not_pending" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records a failed reading when the model fails, and holds no values", async () => {
    const { service, rpc } = makeService();
    const out = await runDocumentCapture(service, "d1", { extract: async () => ({ ok: false, reason: "error" }) });
    expect(out.status).toBe("failed");
    expect(rpc).toHaveBeenCalledWith("record_document_suggestion", expect.objectContaining({ p_failed: true, p_ocr_text: "", p_extracted: {} }));
  });

  it("records a failed reading when governance sends the call to its fallback (kill switch)", async () => {
    runGovernedAi.mockImplementation(async (p: { fallback: () => unknown }) => ({ value: p.fallback() }));
    const { service, rpc } = makeService();
    const extract = jest.fn();
    expect((await runDocumentCapture(service, "d1", { extract })).status).toBe("failed");
    expect(extract).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("record_document_suggestion", expect.objectContaining({ p_failed: true }));
  });

  it("treats a reading with no fields as failed, with a clear reason, not as an empty success", async () => {
    const { service, rpc } = makeService();
    const empty: DocumentCaptureResult = { ok: true, suggestions: { ocrText: "", fields: [], unreadableReason: "too blurred" } };
    const out = await runDocumentCapture(service, "d1", { extract: async () => empty });
    expect(out.status).toBe("failed");
    expect(out.message).toMatch(/straighter, brighter/);
    expect(rpc).toHaveBeenCalledWith("record_document_suggestion", expect.objectContaining({ p_failed: true }));
  });

  it("records failure for an unreadable file type without calling the model", async () => {
    const { service, rpc } = makeService({ fileType: "image/gif" });
    const extract = jest.fn();
    expect((await runDocumentCapture(service, "d1", { extract })).status).toBe("failed");
    expect(extract).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("record_document_suggestion", expect.objectContaining({ p_failed: true }));
  });

  it("records failure when the photo cannot be opened", async () => {
    const { service } = makeService({ downloadError: true });
    expect((await runDocumentCapture(service, "d1", { extract: jest.fn() })).status).toBe("failed");
  });

  it("reports a closed guard (55000), stores no suggestions, and marks the reading failed so the photo does not wait forever", async () => {
    const { service, rpc } = makeService({ rpcError: { code: "55000", message: "document capture is not open" } });
    const out = await runDocumentCapture(service, "d1", { extract: async () => SUGGESTED });
    expect(out.status).toBe("closed");
    expect(rpc).toHaveBeenLastCalledWith("record_document_suggestion", expect.objectContaining({ p_failed: true, p_extracted: {} }));
  });

  it("never throws, even if the governed wrapper itself throws: the photo is kept and the reading is recorded as failed", async () => {
    runGovernedAi.mockRejectedValueOnce(new Error("boom"));
    const { service, rpc } = makeService();
    await expect(runDocumentCapture(service, "d1", { extract: async () => SUGGESTED })).resolves.toMatchObject({ status: "failed" });
    expect(rpc).toHaveBeenCalledWith("record_document_suggestion", expect.objectContaining({ p_failed: true }));
  });
});
