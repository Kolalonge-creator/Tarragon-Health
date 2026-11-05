import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ScannerClient } from "@tarragon/shared";

const runLabReportExtraction = jest.fn().mockResolvedValue({ status: "extracted" });
const runEcgReportExtraction = jest.fn().mockResolvedValue({ status: "extracted" });
const runImagingReportExtraction = jest.fn().mockResolvedValue({ status: "extracted" });
const runDocumentClassification = jest.fn().mockResolvedValue({ pipeline: null, asked: true });
jest.mock("@/lib/lab-reports/extraction-actions", () => ({ runLabReportExtraction: (...a: unknown[]) => runLabReportExtraction(...a) }));
jest.mock("@/lib/ecg-reports/extraction-actions", () => ({ runEcgReportExtraction: (...a: unknown[]) => runEcgReportExtraction(...a) }));
jest.mock("@/lib/imaging-reports/extraction-actions", () => ({ runImagingReportExtraction: (...a: unknown[]) => runImagingReportExtraction(...a) }));
jest.mock("@/lib/clinical-documents/classify-run", () => ({ runDocumentClassification: (...a: unknown[]) => runDocumentClassification(...a) }));

import { rescanHeldUploads, startReadersForClearedUploads } from "./sweep";

const bytes = new TextEncoder().encode("%PDF-1.7\n");
const sha = createHash("sha256").update(Buffer.from(bytes)).digest("hex");

const due = [
  { document_id: "d1", scan_status: "pending_scan", bucket: "lab-result-documents", file_path: "p/1.pdf", mime_type: "application/pdf", routed_table: "lab_result_documents", routed_id: "r1", patient_id: "p", organisation_id: "o", scan_attempts: 1 },
  { document_id: "d2", scan_status: "unscanned", bucket: "ecg-reports", file_path: "p/2.pdf", mime_type: "application/pdf", routed_table: "ecg_report_documents", routed_id: "r2", patient_id: "p", organisation_id: "o", scan_attempts: 0 },
  { document_id: "d3", scan_status: "pending_scan", bucket: "lab-results", file_path: "p/3.pdf", mime_type: "application/pdf", routed_table: "lab_result_files", routed_id: "r3", patient_id: "p", organisation_id: "o", scan_attempts: 2 },
];

function fakeService(verdictFor: (doc: string, verdict: string) => string) {
  const rpc = jest.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "upload_scan_due") return { data: due, error: null };
    if (name === "apply_upload_scan_verdict") return { data: verdictFor(String(args.p_document), String(args.p_verdict)), error: null };
    if (name === "upload_scan_backlog_check") return { data: 1, error: null };
    return { data: null, error: null };
  });
  const download = jest.fn(async (path: string) =>
    path === "p/3.pdf" ? { data: null, error: { message: "gone" } } : { data: new Blob([bytes]), error: null },
  );
  const client = { rpc, storage: { from: () => ({ download }) } } as unknown as SupabaseClient<Database>;
  return { rpc, download, client };
}

const scanner = (status: "clean" | "infected" | null): ScannerClient => ({
  scan: jest.fn().mockResolvedValue(
    status === null ? null : { status, signature: status === "infected" ? "Eicar" : null, engine_version: "e", db_version: "d", size_bytes: 9, sha256: sha },
  ),
  health: jest.fn(),
});

describe("rescanHeldUploads", () => {
  it("does not scan when the scanner is off, but still refreshes the held-documents incident", async () => {
    const s = fakeService(() => "pending_scan");
    const r = await rescanHeldUploads(s.client, null);
    expect(r.skipped).toBe("scanner_off");
    expect(s.rpc).not.toHaveBeenCalledWith("upload_scan_due", expect.anything());
    expect(s.rpc).toHaveBeenCalledWith("upload_scan_backlog_check");
  });

  it("applies each verdict and returns only held documents that are now clean", async () => {
    const s = fakeService((_d, v) => v);
    const r = await rescanHeldUploads(s.client, scanner("clean"));
    expect(r.considered).toBe(3);
    // d3's file could not be downloaded: it is reported as unavailable, never as clean.
    expect(s.rpc).toHaveBeenCalledWith("apply_upload_scan_verdict", expect.objectContaining({ p_document: "d3", p_verdict: "unavailable" }));
    expect(r.clean).toBe(2);
    expect(r.stillHeld).toBe(1);
    // d2 was unscanned (already visible and read): only d1 needs its reader started.
    expect(r.cleared).toEqual([{ documentId: "d1", routedTable: "lab_result_documents", routedId: "r1" }]);
  });

  it("counts an infected file and never clears it", async () => {
    const s = fakeService((_d, v) => v);
    const r = await rescanHeldUploads(s.client, scanner("infected"));
    expect(r.infected).toBe(2);
    expect(r.cleared).toEqual([]);
  });

  it("treats an unreachable scanner as unavailable for every document", async () => {
    const s = fakeService((_d, v) => (v === "unavailable" ? "pending_scan" : v));
    const r = await rescanHeldUploads(s.client, scanner(null));
    expect(r.clean).toBe(0);
    expect(s.rpc.mock.calls.filter((c) => c[0] === "apply_upload_scan_verdict").every((c) => (c[1] as { p_verdict: string }).p_verdict === "unavailable")).toBe(true);
  });
});

describe("startReadersForClearedUploads", () => {
  it("starts the lab reader for a patient's own cleared upload, and the sorter for an unsorted one", async () => {
    const maybeSingle = jest.fn().mockResolvedValue({
      data: { id: "r1", organisation_id: "o", patient_id: "p", file_path: "p/1.pdf", mime_type: "application/pdf", test_code: null, source: "patient" },
    });
    const svc = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) } as unknown as SupabaseClient<Database>;
    const n = await startReadersForClearedUploads(svc, [
      { documentId: "d1", routedTable: "lab_result_documents", routedId: "r1" },
      { documentId: "d9", routedTable: null, routedId: null },
      { documentId: "d3", routedTable: "lab_result_files", routedId: "r3" },
    ]);
    expect(n).toBe(2);
    expect(runLabReportExtraction).toHaveBeenCalledWith(svc, expect.objectContaining({ documentId: "r1", filePath: "p/1.pdf" }));
    expect(runDocumentClassification).toHaveBeenCalledWith(svc, "d9");
  });
});
