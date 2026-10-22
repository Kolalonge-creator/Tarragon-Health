/**
 * The shared "read this photo" rules (S43m): the owner only, only while waiting, and a closed guard keeps the photo and reaches no model. A closed
 * answer is only given when the photo was really marked: if marking it failed, that is an error, not "closed".
 */
const maybeSingle = jest.fn();
const rpc = jest.fn();
const serviceRpc = jest.fn();
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: (...a: unknown[]) => serviceRpc(...a) }) }));
const runDocumentCapture = jest.fn();
jest.mock("./run", () => ({ DOCUMENT_CAPTURE_GUARD: "document_capture_enabled", runDocumentCapture: (...a: unknown[]) => runDocumentCapture(...a) }));

import { requestReadingFor } from "./request-reading";

const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => maybeSingle() }) }) }), rpc: (...a: unknown[]) => rpc(...a) } as never;

beforeEach(() => {
  maybeSingle.mockReset().mockResolvedValue({ data: { id: "d", patient_id: "p1", ocr_state: "pending" } });
  rpc.mockReset().mockResolvedValue({ data: false });
  serviceRpc.mockReset().mockResolvedValue({ data: null, error: null });
  runDocumentCapture.mockReset().mockResolvedValue({ status: "suggested", fieldCount: 1, message: "Check each detail." });
});

describe("requestReadingFor", () => {
  it("says not_pending (not a failure) for a document that is no longer waiting", async () => {
    maybeSingle.mockResolvedValue({ data: { id: "d", patient_id: "p1", ocr_state: "suggested" } });
    expect(await requestReadingFor(client, "p1", "d")).toMatchObject({ status: "not_pending", error: expect.any(String) });
    expect(runDocumentCapture).not.toHaveBeenCalled();
  });

  it("a closed guard marks the photo and answers closed, without reaching the reader", async () => {
    expect(await requestReadingFor(client, "p1", "d")).toMatchObject({ success: true, status: "closed" });
    expect(serviceRpc).toHaveBeenCalledWith("record_document_suggestion", expect.objectContaining({ p_failed: true }));
    expect(runDocumentCapture).not.toHaveBeenCalled();
  });

  it("does not answer closed when the photo could not be marked", async () => {
    serviceRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const r = await requestReadingFor(client, "p1", "d");
    expect(r).toMatchObject({ status: "failed", error: expect.any(String) });
    expect(r.success).toBeUndefined();
  });

  it("an open guard runs the reader for the owner", async () => {
    rpc.mockResolvedValue({ data: true });
    expect(await requestReadingFor(client, "p1", "d")).toMatchObject({ success: true, status: "suggested" });
    expect(runDocumentCapture).toHaveBeenCalledTimes(1);
  });
});
