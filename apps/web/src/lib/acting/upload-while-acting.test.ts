/**
 * Slice E review: a patient's own upload files under the signed-in person, so while a supporter is acting for someone every
 * patient upload action refuses (with the reason) instead of saving the file to the supporter's own record. Refused before
 * the rate limit and before anything is scanned or stored.
 */
jest.mock("server-only", () => ({}));
let actingFor: { profileId: string; fullName: string | null } | null = null;
jest.mock("@/lib/acting/acting-for", () => ({ getActingFor: async () => actingFor }));

const touched = jest.fn();
jest.mock("@/lib/security/abuse-limits", () => ({ ABUSE_LIMIT_MESSAGE: "limit", checkAbuseLimit: async () => (touched("limit"), { ok: true }) }));
jest.mock("@/lib/upload-scan/screen", () => ({ screenUpload: async () => (touched("scan"), { ok: false, error: "stop" }) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    touched("db");
    throw new Error("must not reach the database");
  },
  getCurrentUser: async () => ({ id: "supporter-1" }),
}));
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
jest.mock("@/lib/lab-reports/extraction-actions", () => ({ runLabReportExtraction: jest.fn() }));

import { uploadRefusedWhileActing } from "./upload-while-acting";
import { replaceResultDocumentAsPatient, uploadResultDocumentAsPatient } from "@/lib/lab-results/actions";
import { addOwnLabResult } from "@/lib/lab-results/structured-actions";
import { uploadEcgReportAsPatient } from "@/lib/ecg-reports/actions";
import { uploadImagingReportAsPatient } from "@/lib/imaging-reports/document-actions";

const form = () => {
  const f = new FormData();
  f.set("file", new File(["%PDF-1.7"], "r.pdf", { type: "application/pdf" }));
  return f;
};

beforeEach(() => {
  actingFor = null;
  touched.mockClear();
});

describe("uploadRefusedWhileActing", () => {
  it("allows an upload when not acting for anyone", async () => {
    expect(await uploadRefusedWhileActing()).toBeNull();
  });

  it("names the person and says where the file would have gone", async () => {
    actingFor = { profileId: "mum", fullName: "Adaeze Okafor" };
    const message = await uploadRefusedWhileActing();
    expect(message).toContain("You are managing Adaeze's account.");
    expect(message).toContain("saved to your own record");
  });
});

describe("every patient upload action refuses while acting", () => {
  const actions: [string, () => Promise<{ error?: string | null } | unknown>][] = [
    ["lab result", () => uploadResultDocumentAsPatient(form())],
    ["replacement copy", () => replaceResultDocumentAsPatient(form())],
    ["typed-in lab result", () => addOwnLabResult(undefined, form())],
    ["ECG", () => uploadEcgReportAsPatient(form())],
    ["imaging report", () => uploadImagingReportAsPatient(form())],
  ];

  it.each(actions)("%s", async (_name, run) => {
    actingFor = { profileId: "mum", fullName: "Adaeze Okafor" };
    const result = (await run()) as { error?: string };
    expect(result.error).toContain("You are managing Adaeze's account.");
    expect(touched).not.toHaveBeenCalled();
  });
});
