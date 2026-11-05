/**
 * "Not sure what this is?" uploads (clinical document engine step 4), server actions. The rules (own folder only, duplicates, who
 * may answer, routing a lab answer into the lab path, a failure never routes) are proven in the database by
 * packages/db/tests/cde4_document_classifier.sql. This covers what lives here: a refused upload leaves no file behind, a duplicate
 * is reported in words, the classifier runs on the new document, and the lab reader starts only for a lab answer.
 */

const rpc = jest.fn();
const upload = jest.fn();
const remove = jest.fn();
const runDocumentClassification = jest.fn();
const startReader = jest.fn();
const discard = jest.fn();
const routedRow = { data: { routed_table: "lab_result_documents", routed_id: "33333333-3333-4333-8333-333333333333" } };

jest.mock("@/lib/supabase/server", () => ({
  getCurrentUser: jest.fn().mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" }),
  createClient: jest.fn().mockImplementation(async () => ({
    rpc,
    storage: { from: () => ({ upload, remove }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => routedRow }) }) }),
  })),
}));
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ service: true }) }));
// S4 (2026-11-05): a patient has no DELETE on the bucket; the clean-up goes through the server-side discard, never the session.
jest.mock("@/lib/uploads/discard-unfiled-upload", () => ({ discardUnfiledUpload: (...a: unknown[]) => discard(...a) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/validation/result-doc-signature", () => ({
  ...jest.requireActual("@/lib/validation/result-doc-signature"),
  verifyResultDocSignature: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/clinical-documents/classify-run", () => ({
  runDocumentClassification: (...a: unknown[]) => runDocumentClassification(...a),
  startReader: (...a: unknown[]) => startReader(...a),
}));

import { confirmDocumentKind, uploadUnsortedDocument } from "./unsorted-documents-actions";

const DOC = "22222222-2222-4222-8222-222222222222";

function form(): FormData {
  const f = new FormData();
  f.set("file", new File([new Uint8Array([37, 80, 68, 70, 45])], "letter.pdf", { type: "application/pdf" }));
  f.set("note", "From the hospital");
  return f;
}

beforeEach(() => {
  jest.clearAllMocks();
  upload.mockResolvedValue({ error: null });
  remove.mockResolvedValue({ error: null });
  rpc.mockResolvedValue({ data: DOC, error: null });
  runDocumentClassification.mockResolvedValue({ pipeline: null, asked: true });
});

describe("uploadUnsortedDocument", () => {
  it("stores the file in the patient's own folder, records it, then sorts it", async () => {
    await expect(uploadUnsortedDocument(form())).resolves.toEqual({ ok: true, outcome: "question" });
    const path = upload.mock.calls[0][0] as string;
    expect(path.startsWith("11111111-1111-4111-8111-111111111111/")).toBe(true);
    expect(rpc).toHaveBeenCalledWith("submit_unsorted_document", expect.objectContaining({
      p_file_path: path, p_original_filename: "letter.pdf", p_mime_type: "application/pdf", p_note: "From the hospital",
      p_content_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(runDocumentClassification).toHaveBeenCalledWith({ service: true }, DOC);
  });

  it("reports a lab outcome and links a paid walkthrough to the new lab document", async () => {
    runDocumentClassification.mockResolvedValue({ pipeline: "lab", asked: false });
    rpc.mockImplementation(async (name: string) => ({ data: name === "claim_lab_result_consult_credit" ? "req-1" : DOC, error: null }));
    await expect(uploadUnsortedDocument(form())).resolves.toEqual({ ok: true, outcome: "sorted_lab" });
    expect(rpc).toHaveBeenCalledWith("settle_lab_result_consult_claim", { p_request_id: "req-1", p_document_id: routedRow.data.routed_id });
  });

  it("does not promise a question when sorting did not finish", async () => {
    runDocumentClassification.mockResolvedValue({ pipeline: null, asked: false });
    await expect(uploadUnsortedDocument(form())).resolves.toEqual({ ok: true, outcome: "saved" });
  });

  it("removes the stored file when the database refuses, and says why for a duplicate", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "clinical_document_duplicate" } });
    const res = await uploadUnsortedDocument(form());
    expect(res.ok).toBe(false);
    expect(discard).toHaveBeenCalledWith("lab-result-documents", upload.mock.calls[0][0], "11111111-1111-4111-8111-111111111111");
    expect(remove).not.toHaveBeenCalled();
    expect(runDocumentClassification).not.toHaveBeenCalled();
    if (!res.ok) expect(res.error).toMatch(/already/i);
  });
});

describe("confirmDocumentKind", () => {
  it("starts the reader for the pipeline the answer chose, and links a paid walkthrough only for a lab document", async () => {
    rpc.mockImplementation(async (name: string) => ({ data: name === "confirm_clinical_document_kind" ? "lab" : null, error: null }));
    await expect(confirmDocumentKind({ documentId: DOC, kindCode: "lab.haematology" })).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("confirm_clinical_document_kind", { p_document: DOC, p_kind: "lab.haematology" });
    expect(startReader).toHaveBeenCalledWith({ service: true }, DOC, "lab");

    startReader.mockClear();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: "ecg", error: null });
    await confirmDocumentKind({ documentId: DOC, kindCode: "cardiology.ecg" });
    expect(startReader).toHaveBeenCalledWith({ service: true }, DOC, "ecg");
    expect(rpc).not.toHaveBeenCalledWith("claim_lab_result_consult_credit", expect.anything());
  });

  it("refuses a malformed answer before reaching the database", async () => {
    await expect(confirmDocumentKind({ documentId: "not-a-uuid", kindCode: "lab" })).resolves.toEqual({ ok: false, error: "Choose a type from the list." });
    await expect(confirmDocumentKind({ documentId: DOC, kindCode: "Lab; drop" })).resolves.toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
});
