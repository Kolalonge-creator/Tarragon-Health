/**
 * Care Coordinator lab report upload (clinical document engine step 2), server actions. The rules themselves (who may search and
 * upload, a name alone never matches, the identity check, the held result) are proven in the database by
 * packages/db/tests/cde2_coordinator_lab_uploads.sql. This covers what lives here: nothing is stored before the caller is known to
 * be a coordinator in the patient's organisation, a refused upload leaves no file behind, and refusals come back in words.
 */

const rpc = jest.fn();
const profileRows = new Map<string, unknown>();
const storeFile = jest.fn();
const removeFile = jest.fn();

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
jest.mock("@/lib/lab-results/store-file", () => ({
  storeFile: (...a: unknown[]) => storeFile(...a),
  removeFile: (...a: unknown[]) => removeFile(...a),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { findPatientForUpload, uploadLabReportForPatient } from "./actions";

const PATIENT = "22222222-2222-4222-8222-222222222222";
const LAB = "33333333-3333-4333-8333-333333333333";
const STORED = { file_path: `${PATIENT}/x.pdf`, original_filename: "r.pdf", mime_type: "application/pdf", file_size_bytes: 9, content_sha256: "a".repeat(64) };

function form(over: Record<string, string> = {}): FormData {
  const f = new FormData();
  const fields: Record<string, string> = {
    patientId: PATIENT,
    nameOnReport: "Ngozi Okafor",
    dateOfBirthOnReport: "1980-01-15",
    labProviderId: LAB,
    ...over,
  };
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  f.set("file", new File([new Uint8Array([37, 80, 68, 70])], "r.pdf", { type: "application/pdf" }));
  return f;
}

beforeEach(() => {
  jest.clearAllMocks();
  profileRows.clear();
  profileRows.set("coord-1", { role: "care_coordinator", organisation_id: "org-1" });
  profileRows.set(PATIENT, { id: PATIENT, role: "patient", organisation_id: "org-1" });
  storeFile.mockResolvedValue(STORED);
  rpc.mockResolvedValue({ data: { ok: true }, error: null });
});

describe("uploadLabReportForPatient", () => {
  it("stores the file and sends the identity printed on the report to the database", async () => {
    await expect(uploadLabReportForPatient(undefined, form())).resolves.toEqual({ success: true });
    expect(storeFile).toHaveBeenCalledWith(PATIENT, expect.any(File));
    expect(rpc).toHaveBeenCalledWith("coordinator_submit_lab_report", {
      p_patient: PATIENT,
      p_file: STORED,
      p_identity: { name_on_report: "Ngozi Okafor", date_of_birth_on_report: "1980-01-15", patient_number_on_report: null },
      p_source_facility_id: LAB,
    });
  });

  it("stores nothing for an account that is not a coordinator", async () => {
    profileRows.set("coord-1", { role: "patient", organisation_id: "org-1" });
    await expect(uploadLabReportForPatient(undefined, form())).resolves.toEqual({ error: "You do not have access to that." });
    expect(storeFile).not.toHaveBeenCalled();
  });

  it("stores nothing for a patient in another organisation", async () => {
    profileRows.set(PATIENT, { id: PATIENT, role: "patient", organisation_id: "org-2" });
    await expect(uploadLabReportForPatient(undefined, form())).resolves.toEqual({ error: "That patient isn't in your organisation." });
    expect(storeFile).not.toHaveBeenCalled();
  });

  it("asks for a second identifier before touching anything", async () => {
    const r = await uploadLabReportForPatient(undefined, form({ dateOfBirthOnReport: "" }));
    expect(r?.error).toContain("date of birth or the patient number");
    expect(storeFile).not.toHaveBeenCalled();
  });

  it("removes the stored file and explains a refused identity", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "identity_date_of_birth_mismatch" } });
    const r = await uploadLabReportForPatient(undefined, form());
    expect(r?.error).toContain("Do not upload it");
    expect(removeFile).toHaveBeenCalledWith(STORED.file_path);
  });

  it("removes the stored file and explains a duplicate", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "clinical_document_duplicate" } });
    const r = await uploadLabReportForPatient(undefined, form());
    expect(r?.error).toContain("already in this record");
    expect(removeFile).toHaveBeenCalledWith(STORED.file_path);
  });
});

describe("findPatientForUpload", () => {
  it("passes the date of birth only when given, and reshapes the answer", async () => {
    rpc.mockResolvedValue({
      data: [{ patient_id: PATIENT, patient_number: "TH-1", full_name: "Ngozi Okafor", birth_year: 1980, sex: "female", state: "Lagos", phone_last4: "4567" }],
      error: null,
    });
    const r = await findPatientForUpload({ query: "TH-1" });
    expect(rpc).toHaveBeenCalledWith("find_patient_for_upload", { p_query: "TH-1" });
    expect(r).toEqual({
      patients: [{ patientId: PATIENT, patientNumber: "TH-1", fullName: "Ngozi Okafor", birthYear: 1980, sex: "female", state: "Lagos", phoneLast4: "4567" }],
    });
  });

  it("explains a name search without a date of birth", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "find_patient_name_needs_date_of_birth" } });
    const r = await findPatientForUpload({ query: "Ngozi Okafor" });
    expect(r).toEqual({ error: expect.stringContaining("add the date of birth") });
  });
});
