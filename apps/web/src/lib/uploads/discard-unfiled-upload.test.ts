/**
 * S4: the server-side clean-up of an unfiled clinical upload. Proves: a path outside the patient's folder or a bucket outside the
 * three is refused without a round trip; the object is removed (service role) only when the database check says it is unfiled;
 * a refusal or an error never removes anything, and never throws.
 */
const captureException = jest.fn();
jest.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureException(...a) }));

let allowed: boolean | null = true;
let rpcError: { message: string } | null = null;
let removeError: { message: string } | null = null;
const remove = jest.fn(async () => ({ error: removeError }));
const from = jest.fn(() => ({ remove }));
const rpc = jest.fn(async () => ({ data: rpcError ? null : allowed, error: rpcError }));
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ rpc, storage: { from } }),
}));

import { discardUnfiledUpload, type ClinicalUploadBucket } from "./discard-unfiled-upload";

beforeEach(() => {
  allowed = true;
  rpcError = removeError = null;
  jest.clearAllMocks();
});

describe("discardUnfiledUpload", () => {
  it("asks the database, then removes the patient's own unfiled upload with the service role", async () => {
    expect(await discardUnfiledUpload("lab-result-documents", "p1/x.pdf", "p1")).toBe(true);
    expect(rpc).toHaveBeenCalledWith("discard_unfiled_clinical_upload", { p_bucket: "lab-result-documents", p_name: "p1/x.pdf", p_patient: "p1" });
    expect(from).toHaveBeenCalledWith("lab-result-documents");
    expect(remove).toHaveBeenCalledWith(["p1/x.pdf"]);
  });

  it("removes nothing when the database refuses (a filed file, a care-team file)", async () => {
    allowed = false;
    expect(await discardUnfiledUpload("ecg-reports", "p1/x.png", "p1")).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it("refuses a path outside the patient's own folder without asking", async () => {
    expect(await discardUnfiledUpload("imaging-reports", "p2/x.jpg", "p1")).toBe(false);
    expect(await discardUnfiledUpload("imaging-reports", "p1x/x.jpg", "p1")).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("refuses a bucket outside the three", async () => {
    expect(await discardUnfiledUpload("patient-avatars" as ClinicalUploadBucket, "p1/x.jpg", "p1")).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never throws and never removes when the check fails; reports it without the path", async () => {
    rpcError = { message: "db down" };
    expect(await discardUnfiledUpload("lab-result-documents", "p1/x.pdf", "p1")).toBe(false);
    expect(remove).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(captureException.mock.calls)).not.toContain("p1/x.pdf");
  });

  it("reports a failed removal and answers false", async () => {
    removeError = { message: "boom" };
    expect(await discardUnfiledUpload("lab-result-documents", "p1/x.pdf", "p1")).toBe(false);
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
