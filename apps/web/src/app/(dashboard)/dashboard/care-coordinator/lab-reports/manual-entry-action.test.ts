/**
 * CDE-02 hand entry, server action. The database rules (identity, provenance, the clinician alert, nothing filed until a doctor
 * files it) are proven by packages/db/tests/cde3_hand_entered_lab_results.sql. This covers what lives here: nothing is stored for
 * an account that may not upload, a record of what was typed is made when no original is attached, a critical value raises the
 * doctor's alert at once, and a refused save leaves no file behind.
 */

const rpc = jest.fn();
const profileRows = new Map<string, unknown>();
const storeResultDocument = jest.fn();
const removeResultDocument = jest.fn();
const renderManualEntryPdf = jest.fn();
const raiseIfCriticalDraft = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  getCurrentUser: jest.fn().mockResolvedValue({ id: "coord-1" }),
  createClient: jest.fn().mockImplementation(async () => ({
    rpc,
    from: () => ({
      select: () => ({
        eq: (_c: string, id: string) => ({
          single: async () => ({ data: profileRows.get(id) ?? null, error: null }),
          maybeSingle: async () => ({ data: profileRows.get(id) ?? null, error: null }),
        }),
      }),
    }),
  })),
}));
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ service: true }) }));
jest.mock("@/lib/lab-results/store-file", () => ({
  storeFile: jest.fn(),
  removeFile: jest.fn(),
  storeResultDocument: (...a: unknown[]) => storeResultDocument(...a),
  removeResultDocument: (...a: unknown[]) => removeResultDocument(...a),
}));
jest.mock("@/lib/clinical-documents/manual-entry-pdf", () => ({ renderManualEntryPdf: (...a: unknown[]) => renderManualEntryPdf(...a) }));
jest.mock("@/lib/lab-reports/escalation-bridge", () => ({ raiseIfCriticalDraft: (...a: unknown[]) => raiseIfCriticalDraft(...a) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { enterResultsByHand } from "./actions";

const PATIENT = "22222222-2222-4222-8222-222222222222";
const LAB = "33333333-3333-4333-8333-333333333333";
const STORED = { file_path: `${PATIENT}/t.pdf`, original_filename: "t.pdf", mime_type: "application/pdf", file_size_bytes: 9, content_sha256: "b".repeat(64) };

function form(over: Record<string, string> = {}, file?: File): FormData {
  const f = new FormData();
  const fields: Record<string, string> = {
    patientId: PATIENT,
    nameOnReport: "Ngozi Okafor",
    dateOfBirthOnReport: "1980-01-15",
    labProviderId: LAB,
    reportDate: "2026-11-03",
    sourceDescription: "Email from Synlab Ikeja",
    rows: JSON.stringify([{ code: "potassium", value: 6.9, unit: "mmol/L", labFlag: "high" }]),
    ...over,
  };
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  if (file) f.set("file", file);
  return f;
}

beforeEach(() => {
  jest.clearAllMocks();
  profileRows.clear();
  profileRows.set("coord-1", { role: "care_coordinator", organisation_id: "org-1", full_name: "Ada Coordinator" });
  profileRows.set(PATIENT, { id: PATIENT, role: "patient", organisation_id: "org-1", full_name: "Ngozi Okafor" });
  profileRows.set(LAB, { name: "Synlab Nigeria" });
  storeResultDocument.mockResolvedValue(STORED);
  renderManualEntryPdf.mockResolvedValue(Buffer.from("%PDF-1.4 typed"));
  rpc.mockResolvedValue({ data: { ok: true, document_id: "doc-1", extraction_id: "ext-1" }, error: null });
  raiseIfCriticalDraft.mockResolvedValue({ raised: true });
});

describe("enterResultsByHand", () => {
  it("with no original, stores a record of what was typed and saves the draft as typed by hand", async () => {
    await expect(enterResultsByHand(undefined, form())).resolves.toEqual({ success: true });
    expect(renderManualEntryPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        patientName: "Ngozi Okafor",
        enteredByName: "Ada Coordinator",
        sourceDescription: "Email from Synlab Ikeja",
        laboratory: "Synlab Nigeria",
        rows: [expect.objectContaining({ test: "Potassium", result: "6.9", unit: "mmol/L", labFlag: "high" })],
      }),
    );
    const stored = storeResultDocument.mock.calls[0]?.[1] as File;
    expect(stored.type).toBe("application/pdf");
    expect(rpc).toHaveBeenCalledWith(
      "coordinator_submit_manual_results",
      expect.objectContaining({
        p_patient: PATIENT,
        p_original_attached: false,
        p_report_date: "2026-11-03",
        p_source_description: "Email from Synlab Ikeja",
        p_manual_details: [{ labFlag: "high", specimen: null, comment: null }],
        p_rows: [expect.objectContaining({ code: "potassium", status: "ready", confidence: "high" })],
      }),
    );
  });

  it("raises the doctor's alert at once for the draft (the bridge decides whether it is critical)", async () => {
    await enterResultsByHand(undefined, form());
    expect(raiseIfCriticalDraft).toHaveBeenCalledWith({ service: true }, expect.objectContaining({ documentId: "doc-1", patientId: PATIENT }));
  });

  it("stores the attached original instead of making a record", async () => {
    const original = new File([new Uint8Array([37, 80, 68, 70])], "synlab.pdf", { type: "application/pdf" });
    await enterResultsByHand(undefined, form({}, original));
    expect(renderManualEntryPdf).not.toHaveBeenCalled();
    expect(storeResultDocument).toHaveBeenCalledWith(PATIENT, original);
    expect(rpc).toHaveBeenCalledWith("coordinator_submit_manual_results", expect.objectContaining({ p_original_attached: true }));
  });

  it("stores nothing for an account that is not a coordinator", async () => {
    profileRows.set("coord-1", { role: "clinician", organisation_id: "org-1", full_name: "Dr X" });
    await expect(enterResultsByHand(undefined, form())).resolves.toEqual({ error: "You do not have access to that." });
    expect(storeResultDocument).not.toHaveBeenCalled();
  });

  it("refuses a test entered twice before storing anything", async () => {
    const rows = JSON.stringify([{ code: "potassium", value: 4, unit: "mmol/L" }, { code: "potassium", value: 5, unit: "mmol/L" }]);
    const r = await enterResultsByHand(undefined, form({ rows }));
    expect(r?.error).toContain("entered twice");
    expect(storeResultDocument).not.toHaveBeenCalled();
  });

  it("removes the stored file on a database refusal and explains it; no alert is raised", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "identity_name_mismatch" } });
    const r = await enterResultsByHand(undefined, form());
    expect(r?.error).toContain("does not match");
    expect(removeResultDocument).toHaveBeenCalledWith(STORED.file_path);
    expect(raiseIfCriticalDraft).not.toHaveBeenCalled();
  });
});
