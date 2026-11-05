/**
 * T2-08 wiring: every lab upload path scans BEFORE it stores. Infected: refused with the calm message and nothing stored. Scanner
 * down ("held"): stored as usual, with the fingerprint the scan computed. The scan itself is mocked here (screen.test.ts proves it).
 */
const screenUpload = jest.fn();
jest.mock("@/lib/upload-scan/screen", () => ({ screenUpload: (...a: unknown[]) => screenUpload(...a) }));

const rpc = jest.fn();
const upload = jest.fn();
const remove = jest.fn();
const insertSingle = jest.fn();
const getUser = jest.fn();
const PATIENT = "99999999-9999-4999-8999-999999999999";
const ORG = "77777777-7777-4777-8777-777777777777";

const userClient = {
  rpc: (...a: unknown[]) => rpc(...a),
  storage: { from: () => ({ upload: (...a: unknown[]) => upload(...a), remove: (...a: unknown[]) => remove(...a) }) },
  from: (table: string) => ({
    select: () => ({
      eq: () => ({
        single: async () => (table === "profiles" ? { data: { organisation_id: ORG }, error: null } : { data: null, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
      }),
    }),
    insert: (row: unknown) => ({ select: () => ({ single: () => insertSingle(table, row) }) }),
  }),
  auth: { getUser: (...a: unknown[]) => getUser(...a) },
};

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => userClient),
  getCurrentUser: jest.fn(async () => ({ id: PATIENT })),
}));
jest.mock("@/lib/supabase/bearer", () => ({ createBearerClient: () => userClient }));
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    rpc: async () => ({ data: [], error: null }),
    storage: { from: () => ({ upload: (...a: unknown[]) => upload(...a), remove: (...a: unknown[]) => remove(...a) }) },
  }),
}));
const runLabReportExtraction = jest.fn().mockResolvedValue({ status: "extracted" });
jest.mock("@/lib/lab-reports/extraction-actions", () => ({ runLabReportExtraction: (...a: unknown[]) => runLabReportExtraction(...a) }));

import { addOwnLabResult } from "@/lib/lab-results/structured-actions";
import { uploadResultDocumentAsPatient } from "@/lib/lab-results/actions";
import { POST as mobileUpload } from "@/app/api/mobile/lab-result-upload/route";

const SHA = "a".repeat(64);
const pdf = () => new File([new TextEncoder().encode("%PDF-1.7\nreport\n")], "report.pdf", { type: "application/pdf" });
const form = (file: File) => {
  const f = new FormData();
  f.set("file", file);
  return f;
};
const CALM = "We could not accept this file because our safety check flagged it. Please ask the lab for a fresh copy.";

beforeEach(() => {
  screenUpload.mockReset();
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
  upload.mockReset().mockResolvedValue({ error: null });
  remove.mockReset().mockResolvedValue({ error: null });
  insertSingle.mockReset().mockResolvedValue({ data: { id: "doc-1" }, error: null });
  getUser.mockReset().mockResolvedValue({ data: { user: { id: PATIENT } }, error: null });
  runLabReportExtraction.mockClear();
});

describe("S27 storeFile (patient adds own result; team, partner and coordinator use the same storeFile)", () => {
  it("refuses an infected file and stores nothing", async () => {
    screenUpload.mockResolvedValue({ ok: false, error: CALM });
    expect(await addOwnLabResult(undefined, form(pdf()))).toEqual({ error: CALM });
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith("patient_add_lab_result", expect.anything());
  });

  it("stores a held file and hands the database the scan's fingerprint", async () => {
    screenUpload.mockResolvedValue({ ok: true, verdict: "held", sha256: SHA });
    expect(await addOwnLabResult(undefined, form(pdf()))).toEqual({ success: true });
    expect(screenUpload).toHaveBeenCalledWith(expect.anything(), expect.any(File), { patientId: PATIENT, uploadedBy: PATIENT });
    expect(upload).toHaveBeenCalledTimes(1);
    const call = rpc.mock.calls.find((c) => c[0] === "patient_add_lab_result");
    expect(call?.[1].p_file.content_sha256).toBe(SHA);
  });
});

describe("uploadResultDocumentAsPatient (web)", () => {
  it("refuses an infected file before claiming any credit or storing anything", async () => {
    screenUpload.mockResolvedValue({ ok: false, error: CALM });
    expect(await uploadResultDocumentAsPatient(form(pdf()))).toEqual({ error: CALM });
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stores a held file with the scan's fingerprint", async () => {
    screenUpload.mockResolvedValue({ ok: true, verdict: "held", sha256: SHA });
    expect(await uploadResultDocumentAsPatient(form(pdf()))).toEqual({ success: true });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(insertSingle).toHaveBeenCalledWith("lab_result_documents", expect.objectContaining({ content_sha256: SHA }));
  });
});

describe("POST /api/mobile/lab-result-upload", () => {
  const request = (file: File) =>
    new Request("http://x/api/mobile/lab-result-upload", { method: "POST", headers: { authorization: "Bearer t" }, body: form(file) });

  it("refuses an infected file with 422 and stores nothing", async () => {
    screenUpload.mockResolvedValue({ ok: false, error: CALM });
    const res = await mobileUpload(request(pdf()));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: CALM });
    expect(upload).not.toHaveBeenCalled();
  });

  it("stores a held file with the scan's fingerprint", async () => {
    screenUpload.mockResolvedValue({ ok: true, verdict: "held", sha256: SHA });
    const res = await mobileUpload(request(pdf()));
    expect(res.status).toBe(200);
    expect(insertSingle).toHaveBeenCalledWith("lab_result_documents", expect.objectContaining({ content_sha256: SHA }));
  });
});
