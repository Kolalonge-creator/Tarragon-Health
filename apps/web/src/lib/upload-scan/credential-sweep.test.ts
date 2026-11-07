import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ScannerClient } from "@tarragon/shared";

jest.mock("@/lib/lab-reports/extraction-actions", () => ({ runLabReportExtraction: jest.fn() }));
jest.mock("@/lib/ecg-reports/extraction-actions", () => ({ runEcgReportExtraction: jest.fn() }));
jest.mock("@/lib/imaging-reports/extraction-actions", () => ({ runImagingReportExtraction: jest.fn() }));
jest.mock("@/lib/clinical-documents/classify-run", () => ({ runDocumentClassification: jest.fn() }));

import { rescanHeldCredentialDocuments } from "./sweep";

/** The daily rescan of clinician credential documents held for the malware scan (migration *_credentialing_upload_malware_scan.sql). */
const bytes = new TextEncoder().encode("%PDF-1.7\n");
const sha = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
const D1 = "11111111-1111-4111-8111-111111111111";
const D2 = "22222222-2222-4222-8222-222222222222";
const D3 = "33333333-3333-4333-8333-333333333333";
const due = [
  { document_id: D1, scan_status: "pending_scan", storage_path: "o/u/1.pdf", scan_attempts: 1 },
  { document_id: D2, scan_status: "unscanned", storage_path: "o/u/2.pdf", scan_attempts: 0 },
  { document_id: D3, scan_status: "pending_scan", storage_path: "o/u/3.pdf", scan_attempts: 2 },
];

function fakeService(apply: (doc: string, verdict: string) => string, list: unknown = due) {
  const buckets: string[] = [];
  const rpc = jest.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "clinician_document_scan_due") return { data: list, error: null };
    if (name === "apply_clinician_document_scan_verdict") return { data: apply(String(args.p_document), String(args.p_verdict)), error: null };
    return { data: null, error: null };
  });
  const download = jest.fn(async (path: string) =>
    path === "o/u/3.pdf" ? { data: null, error: { message: "gone" } } : { data: new Blob([bytes]), error: null },
  );
  const remove = jest.fn(async () => ({ error: null }));
  const client = {
    rpc,
    storage: { from: (b: string) => (buckets.push(b), { download, remove }) },
  } as unknown as SupabaseClient<Database>;
  return { rpc, download, remove, client, buckets };
}

const scanner = (status: "clean" | "infected" | null): ScannerClient => ({
  scan: jest.fn().mockResolvedValue(
    status === null ? null : { status, signature: status === "infected" ? "Eicar" : null, engine_version: "e", db_version: "d", size_bytes: 9, sha256: sha },
  ),
  health: jest.fn(),
});

beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => undefined));

describe("rescanHeldCredentialDocuments", () => {
  it("does nothing when the scanner is off", async () => {
    const svc = fakeService(() => "clean");
    expect(await rescanHeldCredentialDocuments(svc.client, null)).toEqual({ skipped: "scanner_off", considered: 0, clean: 0, infected: 0, stillHeld: 0, errors: 0 });
    expect(svc.rpc).not.toHaveBeenCalled();
  });

  it("reads from the credential bucket and applies each verdict; an unreadable file stays held", async () => {
    const svc = fakeService((doc, verdict) => (verdict === "unavailable" ? "pending_scan" : verdict));
    const summary = await rescanHeldCredentialDocuments(svc.client, scanner("clean"));
    expect(summary).toEqual({ considered: 3, clean: 2, infected: 0, stillHeld: 1, errors: 0 });
    expect(new Set(svc.buckets)).toEqual(new Set(["clinician-documents"]));
    expect(svc.rpc).toHaveBeenCalledWith("apply_clinician_document_scan_verdict", expect.objectContaining({ p_document: D3, p_verdict: "unavailable" }));
  });

  it("counts an infected verdict and deletes that file from the bucket", async () => {
    const svc = fakeService((_doc, verdict) => verdict);
    const summary = await rescanHeldCredentialDocuments(svc.client, scanner("infected"));
    expect(summary.infected).toBe(2);
    expect(svc.remove).toHaveBeenCalledWith(["o/u/1.pdf"]);
    expect(svc.remove).toHaveBeenCalledWith(["o/u/2.pdf"]);
    expect(svc.remove).not.toHaveBeenCalledWith(["o/u/3.pdf"]);
  });

  it("reports an unexpected list shape as an error instead of scanning nothing silently", async () => {
    const svc = fakeService(() => "clean", [{ nope: true }]);
    expect((await rescanHeldCredentialDocuments(svc.client, scanner("clean"))).errors).toBe(1);
  });
});
