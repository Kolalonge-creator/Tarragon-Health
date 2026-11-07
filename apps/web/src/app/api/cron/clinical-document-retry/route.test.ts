/**
 * The daily clinical-document retry fails (500) when a malware rescan step errored, so cron monitoring alerts, while still
 * running every step. A scanner that is merely unavailable is a verdict, not an error, and does not fail the run.
 */
jest.mock("@/lib/cron-auth", () => ({ isCronAuthorised: () => true }));
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
const retryUnreadLabReports = jest.fn();
jest.mock("@/lib/clinical-documents/retry", () => ({ retryUnreadLabReports: (...a: unknown[]) => retryUnreadLabReports(...a) }));
jest.mock("@/lib/clinical-documents/classify-run", () => ({ retryStuckClassifications: async () => ({ retried: 0 }) }));
const rescanHeldUploads = jest.fn();
const rescanHeldCredentialDocuments = jest.fn();
jest.mock("@/lib/upload-scan/sweep", () => ({
  rescanHeldUploads: (...a: unknown[]) => rescanHeldUploads(...a),
  rescanHeldCredentialDocuments: (...a: unknown[]) => rescanHeldCredentialDocuments(...a),
  startReadersForClearedUploads: async () => 0,
}));

import { GET } from "./route";

const uploads = (errors: number) => ({ considered: 0, clean: 0, infected: 0, stillHeld: 0, errors, held: 0, cleared: [] });
const credentials = (errors: number, stillHeld = 0) => ({ considered: 0, clean: 0, infected: 0, stillHeld, errors });
const call = () => GET(new Request("http://x", { headers: { authorization: "Bearer x" } }));

beforeEach(() => {
  retryUnreadLabReports.mockReset().mockResolvedValue({ retried: 0 });
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("clinical-document-retry", () => {
  it("answers 200 when nothing errored, even with documents still held", async () => {
    rescanHeldUploads.mockResolvedValue(uploads(0));
    rescanHeldCredentialDocuments.mockResolvedValue(credentials(0, 2));
    expect((await call()).status).toBe(200);
  });

  it.each([
    ["an upload rescan", 1, 0],
    ["a credential document rescan", 0, 1],
  ])("fails the run when %s errored, after running every step", async (_label, up, cred) => {
    rescanHeldUploads.mockResolvedValue(uploads(up));
    rescanHeldCredentialDocuments.mockResolvedValue(credentials(cred));
    const res = await call();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/malware rescan had 1 error/);
    expect(retryUnreadLabReports).toHaveBeenCalled();
  });
});
