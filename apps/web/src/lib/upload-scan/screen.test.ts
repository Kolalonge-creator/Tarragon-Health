import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ScanResponse, ScannerClient } from "@tarragon/shared";
import { INFECTED_UPLOAD_MESSAGE, SCAN_NOT_RECORDED_MESSAGE, screenUpload } from "./screen";

const bytes = new TextEncoder().encode("%PDF-1.7\nhello\n");
const sha = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
const file = () => new File([bytes], "r.pdf", { type: "application/pdf" });
const ctx = { patientId: "11111111-1111-4111-8111-111111111111", uploadedBy: "22222222-2222-4222-8222-222222222222" };

function service(rpcResult: { error: unknown } = { error: null }) {
  const rpc = jest.fn().mockResolvedValue({ data: null, ...rpcResult });
  return { rpc, client: { rpc } as unknown as SupabaseClient<Database> };
}

function scanner(result: Partial<ScanResponse> | null): ScannerClient {
  return {
    scan: jest.fn().mockResolvedValue(
      result === null
        ? null
        : { status: "clean", signature: null, engine_version: "ClamAV 1.4.1", db_version: "27450", size_bytes: bytes.length, sha256: sha, ...result },
    ),
    health: jest.fn(),
  };
}

describe("screenUpload", () => {
  it("does nothing when the scanner is not configured (document stays unscanned)", async () => {
    const s = service();
    expect(await screenUpload(s.client, file(), ctx, null)).toEqual({ ok: true, verdict: "off", sha256: sha });
    expect(s.rpc).not.toHaveBeenCalled();
  });

  it("records a clean verdict against the file's own fingerprint before it is stored", async () => {
    const s = service();
    expect(await screenUpload(s.client, file(), ctx, scanner({}))).toEqual({ ok: true, verdict: "clean", sha256: sha });
    expect(s.rpc).toHaveBeenCalledWith("record_upload_scan", expect.objectContaining({ p_sha256: sha, p_verdict: "clean", p_patient: ctx.patientId }));
  });

  it("refuses an infected file with the calm message and records it (security incident)", async () => {
    const s = service();
    const r = await screenUpload(s.client, file(), ctx, scanner({ status: "infected", signature: "Eicar-Test-Signature" }));
    expect(r).toEqual({ ok: false, error: INFECTED_UPLOAD_MESSAGE });
    expect(s.rpc).toHaveBeenCalledWith("record_upload_scan", expect.objectContaining({ p_verdict: "infected", p_signature: "Eicar-Test-Signature" }));
    expect(INFECTED_UPLOAD_MESSAGE).not.toMatch(/virus|malware|WARNING|—/);
  });

  it("refuses an infected file even if the verdict could not be recorded", async () => {
    const s = service({ error: { message: "db down" } });
    expect(await screenUpload(s.client, file(), ctx, scanner({ status: "infected", signature: "x" }))).toEqual({ ok: false, error: INFECTED_UPLOAD_MESSAGE });
  });

  it("holds the file (pending_scan) when the scanner is unreachable, never treating it as clean", async () => {
    const s = service();
    expect(await screenUpload(s.client, file(), ctx, scanner(null))).toEqual({ ok: true, verdict: "held", sha256: sha });
    expect(s.rpc).toHaveBeenCalledWith("record_upload_scan", expect.objectContaining({ p_verdict: "unavailable" }));
  });

  it("holds the file when clamd answered with an error", async () => {
    const s = service();
    expect((await screenUpload(s.client, file(), ctx, scanner({ status: "error" }))).ok).toBe(true);
    expect(s.rpc.mock.calls[0][1].p_verdict).toBe("unavailable");
  });

  it("holds the file when the scanner hashed different bytes", async () => {
    const s = service();
    await screenUpload(s.client, file(), ctx, scanner({ sha256: "0".repeat(64) }));
    expect(s.rpc.mock.calls[0][1].p_verdict).toBe("unavailable");
  });

  it("refuses rather than stores an unscanned file when the hold itself cannot be recorded", async () => {
    const s = service({ error: { message: "db down" } });
    expect(await screenUpload(s.client, file(), ctx, scanner(null))).toEqual({ ok: false, error: SCAN_NOT_RECORDED_MESSAGE });
  });
});
