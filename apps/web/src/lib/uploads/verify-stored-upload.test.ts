/**
 * @jest-environment node
 *
 * Security audit 2026-11-05 (M-4/L-4): the server check of files a client wrote straight to Storage. It must run the same
 * prepareUpload a server upload does: a mismatch is quarantined (never left where it can be served), a photo with location
 * metadata is replaced by its clean copy, anything else is left alone, and every outcome is recorded.
 */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
const captured: string[] = [];
jest.mock("@sentry/nextjs", () => ({ captureMessage: (m: string) => captured.push(m) }));

import { QUARANTINE_BUCKET, runClientUploadChecks, verifyStoredUpload } from "./verify-stored-upload";

const enc = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s, "latin1"));
function jpegWithExif(): Uint8Array {
  const exif = [...enc("Exif"), 0, 0, ...enc("GPS-HERE")];
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, exif.length + 2, ...exif, 0xff, 0xda, 0, 2, 0x11, 0x22, 0x33, 0xff, 0xd9]);
}
const PDF = Uint8Array.from(enc("%PDF-1.7\n1 0 obj\n"));
const HTML = Uint8Array.from(enc("<html><script>alert(1)</script></html>"));

type Stored = { bytes: Uint8Array; type: string };
let objects: Map<string, Stored>;
let uploads: { bucket: string; path: string; bytes: Uint8Array; contentType?: string; upsert?: boolean }[];
let removes: { bucket: string; paths: string[] }[];
let rpcs: { fn: string; args: Record<string, unknown> }[];
let claimRows: { bucket_id: string; object_name: string; mimetype: string | null; owner_id: string }[];
let rowStatus: string;

function fakeService() {
  return {
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          const o = objects.get(`${bucket}/${path}`);
          return o ? { data: new Blob([Uint8Array.from(o.bytes)], { type: o.type }), error: null } : { data: null, error: { message: "Object not found" } };
        },
        upload: async (path: string, bytes: Uint8Array, opts: { contentType?: string; upsert?: boolean }) => {
          uploads.push({ bucket, path, bytes, contentType: opts.contentType, upsert: opts.upsert });
          return { error: null };
        },
        remove: async (paths: string[]) => {
          removes.push({ bucket, paths });
          return { error: null };
        },
      }),
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      if (fn === "claim_client_upload_checks") return { data: claimRows, error: null };
      if (fn === "client_upload_check_outcome") return { data: rowStatus, error: null };
      return { data: true, error: null };
    },
  } as unknown as SupabaseClient<Database>;
}

beforeEach(() => {
  objects = new Map();
  uploads = [];
  removes = [];
  rpcs = [];
  claimRows = [];
  rowStatus = "checking";
  captured.length = 0;
});

describe("verifyStoredUpload", () => {
  it("a file whose bytes are not what it claims is moved to quarantine as opaque bytes and removed from where the client put it", async () => {
    objects.set("care-message-attachments/u1/a.jpg", { bytes: HTML, type: "image/jpeg" });
    const r = await verifyStoredUpload(fakeService(), { bucket_id: "care-message-attachments", object_name: "u1/a.jpg", mimetype: "image/jpeg", owner_id: "u1" });
    expect(r.outcome).toBe("quarantined");
    expect(uploads).toEqual([
      expect.objectContaining({ bucket: QUARANTINE_BUCKET, path: "care-message-attachments/u1/a.jpg", contentType: "application/octet-stream" }),
    ]);
    expect(removes).toEqual([{ bucket: "care-message-attachments", paths: ["u1/a.jpg"] }]);
  });

  it("a photo with location metadata is replaced in place by its clean copy", async () => {
    objects.set("meal-photos/u1/m.jpg", { bytes: jpegWithExif(), type: "image/jpeg" });
    const r = await verifyStoredUpload(fakeService(), { bucket_id: "meal-photos", object_name: "u1/m.jpg", mimetype: "image/jpeg", owner_id: "u1" });
    expect(r.outcome).toBe("cleaned");
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({ bucket: "meal-photos", path: "u1/m.jpg", contentType: "image/jpeg", upsert: true });
    expect(has(uploads[0]!.bytes, "GPS-HERE")).toBe(false);
    expect(removes).toHaveLength(0);
  });

  it("a real PDF is left alone", async () => {
    objects.set("patient-documents/u1/d.pdf", { bytes: PDF, type: "application/pdf" });
    const r = await verifyStoredUpload(fakeService(), { bucket_id: "patient-documents", object_name: "u1/d.pdf", mimetype: "application/pdf", owner_id: "u1" });
    expect(r.outcome).toBe("clean");
    expect(uploads).toHaveLength(0);
    expect(removes).toHaveLength(0);
  });

  it("a PDF declared as a photo is refused (a photo labelled as a PDF or the reverse never passes)", async () => {
    objects.set("second-opinion-documents/u1/x.jpg", { bytes: PDF, type: "image/jpeg" });
    const r = await verifyStoredUpload(fakeService(), { bucket_id: "second-opinion-documents", object_name: "u1/x.jpg", mimetype: "image/jpeg", owner_id: "u1" });
    expect(r.outcome).toBe("quarantined");
  });

  it("a publicly served photo that cannot be cleaned is refused, as on the server path", async () => {
    // Starts like a JPEG but does not parse, so it cannot be stripped.
    objects.set("clinical-staff-photos/org/p.jpg", { bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0x00, 0x01]), type: "image/jpeg" });
    const r = await verifyStoredUpload(fakeService(), { bucket_id: "clinical-staff-photos", object_name: "org/p.jpg", mimetype: "image/jpeg", owner_id: "u1" });
    expect(r.outcome).toBe("quarantined");
  });

  it("a file the user replaced while it was being checked is neither overwritten nor removed", async () => {
    rowStatus = "pending"; // the trigger reset the row when the new file landed
    objects.set("meal-photos/u1/m.jpg", { bytes: jpegWithExif(), type: "image/jpeg" });
    const cleanCase = await verifyStoredUpload(fakeService(), { bucket_id: "meal-photos", object_name: "u1/m.jpg", mimetype: "image/jpeg", owner_id: "u1" });
    expect(cleanCase.outcome).toBe("error");
    expect(uploads).toHaveLength(0);
    objects.set("meal-photos/u1/bad.jpg", { bytes: HTML, type: "image/jpeg" });
    await verifyStoredUpload(fakeService(), { bucket_id: "meal-photos", object_name: "u1/bad.jpg", mimetype: "image/jpeg", owner_id: "u1" });
    expect(removes).toHaveLength(0);
  });

  it("a real file with no declared type is judged by its bytes, not refused for the missing label", async () => {
    objects.set("patient-documents/u1/d.pdf", { bytes: PDF, type: "" });
    const r = await verifyStoredUpload(fakeService(), { bucket_id: "patient-documents", object_name: "u1/d.pdf", mimetype: null, owner_id: "u1" });
    expect(r.outcome).toBe("clean");
  });

  it("an object already gone is recorded as gone, not as an error", async () => {
    const r = await verifyStoredUpload(fakeService(), { bucket_id: "meal-photos", object_name: "u1/none.jpg", mimetype: "image/jpeg", owner_id: "u1" });
    expect(r.outcome).toBe("gone");
  });
});

describe("runClientUploadChecks", () => {
  it("records every claimed object's outcome", async () => {
    objects.set("patient-documents/u1/d.pdf", { bytes: PDF, type: "application/pdf" });
    objects.set("meal-photos/u1/bad.jpg", { bytes: HTML, type: "image/jpeg" });
    claimRows = [
      { bucket_id: "patient-documents", object_name: "u1/d.pdf", mimetype: "application/pdf", owner_id: "u1" },
      { bucket_id: "meal-photos", object_name: "u1/bad.jpg", mimetype: "image/jpeg", owner_id: "u1" },
    ];
    const r = await runClientUploadChecks(fakeService());
    expect(r).toMatchObject({ checked: 2, outcomes: { clean: 1, quarantined: 1 } });
    const finished = rpcs.filter((c) => c.fn === "finish_client_upload_check").map((c) => [c.args.p_name, c.args.p_status]);
    expect(finished).toEqual([["u1/d.pdf", "clean"], ["u1/bad.jpg", "quarantined"]]);
    expect(captured).toEqual(["client upload check: quarantined"]);
  });

  it("the 'check my upload' path claims only that object, for that writer", async () => {
    await runClientUploadChecks(fakeService(), { limit: 1, only: { bucket: "meal-photos", name: "u1/m.jpg", ownerId: "u1" } });
    expect(rpcs[0]).toEqual({ fn: "claim_client_upload_checks", args: { p_limit: 1, p_bucket: "meal-photos", p_name: "u1/m.jpg", p_owner: "u1" } });
  });

  it("a failed claim is reported, not swallowed", async () => {
    const service = fakeService();
    (service as unknown as { rpc: unknown }).rpc = jest.fn(async () => ({ data: null, error: { message: "boom" } }));
    expect(await runClientUploadChecks(service)).toEqual({ error: "boom" });
  });
});
