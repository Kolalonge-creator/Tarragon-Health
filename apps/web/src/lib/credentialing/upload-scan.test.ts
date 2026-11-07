/**
 * Credentialing uploads are malware-scanned before they are stored (migration *_credentialing_upload_malware_scan.sql). The scan
 * itself is mocked (upload-scan/screen.test.ts proves it); these tests pin the wiring: infected is refused with a calm,
 * credential-specific message and nothing is stored; scanner down ("held") and clean are stored and registered as usual;
 * the scan sees exactly the bytes that are stored.
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const screenUpload = jest.fn<(...a: unknown[]) => Promise<{ ok: true; verdict: string; sha256: string } | { ok: false; error: string }>>();
jest.mock("@/lib/upload-scan/screen", () => ({
  INFECTED_UPLOAD_MESSAGE: "LAB INFECTED MESSAGE",
  screenUpload: (...a: unknown[]) => screenUpload(...a),
}));
const rpc = jest.fn<(fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: null }>>();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: (fn: string, args: Record<string, unknown>) => rpc(fn, args) }) }));
const upload = jest.fn<(...a: unknown[]) => Promise<{ error: null }>>();
const remove = jest.fn<(...a: unknown[]) => Promise<{ error: null }>>();
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ storage: { from: () => ({ upload: (...a: unknown[]) => upload(...a), remove: (...a: unknown[]) => remove(...a) }) } }),
}));
jest.mock("@/lib/auth/current-profile", () => ({
  getCurrentProfile: async () => ({ id: "11111111-1111-4111-8111-111111111111", organisation_id: "22222222-2222-4222-8222-222222222222" }),
}));
jest.mock("./queries", () => ({ getMyApplication: async () => ({ id: "app" }), getMyCredentialStatus: async () => null }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
class Redirect extends Error {
  constructor(readonly to: string) {
    super(to);
  }
}
jest.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));

import { uploadCredentialDocument } from "./applicant-actions";

const PDF = new TextEncoder().encode("%PDF-1.7\nlicence\n");
function form(): FormData {
  const fd = new FormData();
  fd.set("kind", "cv");
  fd.set("file", new File([PDF], "cv.pdf", { type: "application/pdf" }));
  return fd;
}
async function outcome(): Promise<string> {
  try {
    await uploadCredentialDocument(form());
  } catch (e) {
    if (e instanceof Redirect) return decodeURIComponent(e.to);
    throw e;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  screenUpload.mockReset();
  rpc.mockReset().mockResolvedValue({ data: "doc-id", error: null });
  upload.mockReset().mockResolvedValue({ error: null });
  remove.mockReset().mockResolvedValue({ error: null });
});

describe("uploadCredentialDocument malware scan", () => {
  it("refuses an infected file with the credential wording and stores nothing", async () => {
    screenUpload.mockResolvedValue({ ok: false, error: "LAB INFECTED MESSAGE" });
    const to = await outcome();
    expect(to).toContain("error=");
    expect(to).toContain("download a fresh copy from the issuer");
    expect(to).not.toContain("LAB INFECTED MESSAGE");
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes any other refusal through (the hold could not be recorded)", async () => {
    screenUpload.mockResolvedValue({ ok: false, error: "We could not save this file just now." });
    expect(await outcome()).toContain("We could not save this file just now.");
    expect(upload).not.toHaveBeenCalled();
  });

  it.each(["clean", "held", "off"])("stores and registers the file when the scan says %s", async (verdict) => {
    screenUpload.mockResolvedValue({ ok: true, verdict, sha256: "a".repeat(64) });
    expect(await outcome()).toContain("ok=Document uploaded.");
    expect(upload).toHaveBeenCalledTimes(1);
    // the registered fingerprint is the one the scan verdict was recorded against
    expect(rpc).toHaveBeenCalledWith("register_clinician_document", expect.objectContaining({ p_kind: "cv", p_sha256: "a".repeat(64) }));
  });

  it("scans exactly the bytes it stores, before storing them, as the uploading clinician", async () => {
    screenUpload.mockResolvedValue({ ok: true, verdict: "clean", sha256: "a".repeat(64) });
    await outcome();
    const [, scanned, ctx] = screenUpload.mock.calls[0] ?? [];
    expect(new Uint8Array(await (scanned as Blob).arrayBuffer())).toEqual(PDF);
    expect(ctx).toEqual({ credentialOwner: "11111111-1111-4111-8111-111111111111" });
    expect(screenUpload.mock.invocationCallOrder[0]).toBeLessThan(upload.mock.invocationCallOrder[0] ?? 0);
  });
});
