/**
 * The photo capture server actions (S43, spec 2.3).
 *
 * Proves: a closed capture guard keeps the photo and never reaches the reader,
 * only the owner can ask for a reading, confirm sends only what the patient
 * decided, reject calls the rejecting function (which leaves no values), and
 * database errors reach the patient as plain words.
 */

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const getCurrentUser = jest.fn();
const rpc = jest.fn();
const maybeSingle = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  getCurrentUser: () => getCurrentUser(),
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => maybeSingle() }) }) }),
    rpc: (...args: unknown[]) => rpc(...args),
  }),
}));
const serviceRpc = jest.fn();
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ service: true, rpc: (...args: unknown[]) => serviceRpc(...args) }) }));
const runDocumentCapture = jest.fn();
jest.mock("./run", () => ({
  DOCUMENT_CAPTURE_GUARD: "document_capture_enabled",
  runDocumentCapture: (...args: unknown[]) => runDocumentCapture(...args),
}));

import { confirmDocumentFieldsAction, rejectDocumentReadingAction, requestDocumentReadingAction } from "./actions";

const DOC = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  getCurrentUser.mockReset().mockResolvedValue({ id: "p1" });
  rpc.mockReset();
  serviceRpc.mockReset().mockResolvedValue({ data: null, error: null });
  maybeSingle.mockReset().mockResolvedValue({ data: { id: DOC, patient_id: "p1", ocr_state: "pending" } });
  runDocumentCapture.mockReset().mockResolvedValue({ status: "suggested", fieldCount: 2, message: "Check each detail." });
});

describe("requestDocumentReadingAction", () => {
  it("refuses a malformed id and a signed-out caller before anything else", async () => {
    expect(await requestDocumentReadingAction("nope")).toMatchObject({ error: expect.any(String) });
    getCurrentUser.mockResolvedValue(null);
    expect(await requestDocumentReadingAction(DOC)).toEqual({ error: "Not signed in" });
    expect(runDocumentCapture).not.toHaveBeenCalled();
  });

  it("refuses a document that is not the caller's", async () => {
    maybeSingle.mockResolvedValue({ data: { id: DOC, patient_id: "someone-else", ocr_state: "pending" } });
    expect(await requestDocumentReadingAction(DOC)).toMatchObject({ error: expect.any(String) });
    expect(runDocumentCapture).not.toHaveBeenCalled();
  });

  it("refuses a document that is not waiting for a reading", async () => {
    maybeSingle.mockResolvedValue({ data: { id: DOC, patient_id: "p1", ocr_state: "confirmed" } });
    expect(await requestDocumentReadingAction(DOC)).toMatchObject({ error: expect.any(String) });
    expect(runDocumentCapture).not.toHaveBeenCalled();
  });

  it("keeps the photo and never calls the reader while the guard is closed", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const out = await requestDocumentReadingAction(DOC);
    expect(out).toMatchObject({ success: true, status: "closed" });
    expect(rpc).toHaveBeenCalledWith("go_live_guard_is_open", { p_key: "document_capture_enabled" });
    expect(runDocumentCapture).not.toHaveBeenCalled();
    // the photo stops waiting: the reading is marked failed (no guard needed), holding nothing
    expect(serviceRpc).toHaveBeenCalledWith("record_document_suggestion", expect.objectContaining({ p_document: DOC, p_failed: true, p_extracted: {} }));
  });

  it("fails closed when the guard check itself errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    expect(await requestDocumentReadingAction(DOC)).toMatchObject({ status: "closed" });
    expect(runDocumentCapture).not.toHaveBeenCalled();
  });

  it("runs the reader under the service client once the guard is open", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const out = await requestDocumentReadingAction(DOC);
    expect(out).toMatchObject({ success: true, status: "suggested" });
    expect(runDocumentCapture).toHaveBeenCalledWith(expect.objectContaining({ service: true }), DOC);
  });

  it("surfaces a failed reading as an error with the by-hand message", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    runDocumentCapture.mockResolvedValue({ status: "failed", fieldCount: 0, message: "Type the details in by hand." });
    expect(await requestDocumentReadingAction(DOC)).toMatchObject({ error: "Type the details in by hand.", status: "failed" });
  });
});

describe("confirmDocumentFieldsAction", () => {
  it("sends the patient's decisions to the confirming function and reports what was kept", async () => {
    rpc.mockResolvedValue({ data: { kept: 2 }, error: null });
    const out = await confirmDocumentFieldsAction(DOC, [{ key: "hb", accept: true, value: "12.4" }, { key: "wbc", accept: false }]);
    expect(rpc).toHaveBeenCalledWith("confirm_document_extraction", { p_document: DOC, p_fields: [{ key: "hb", accept: true, value: "12.4" }, { key: "wbc", accept: false }] });
    expect(out).toEqual({ success: true, message: "Kept 2 details." });
  });

  it("rejects an over-long edited value before the database is reached", async () => {
    expect(await confirmDocumentFieldsAction(DOC, [{ key: "hb", accept: true, value: "x".repeat(401) }])).toMatchObject({ error: expect.any(String) });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("turns database errors into plain words", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "confirm at least one field, or reject the reading" } });
    expect(await confirmDocumentFieldsAction(DOC, [{ key: "hb", accept: false }])).toEqual({ error: "Confirm at least one detail, or reject the reading." });
    rpc.mockResolvedValue({ data: null, error: { message: "something internal" } });
    expect((await confirmDocumentFieldsAction(DOC, [{ key: "hb", accept: true }])).error).toBe("That could not be saved. Please try again.");
  });
});

describe("rejectDocumentReadingAction", () => {
  it("calls the rejecting function and says the photo is kept", async () => {
    rpc.mockResolvedValue({ data: { state: "rejected" }, error: null });
    const out = await rejectDocumentReadingAction(DOC);
    expect(rpc).toHaveBeenCalledWith("reject_document_extraction", { p_document: DOC });
    expect(out).toMatchObject({ success: true, message: expect.stringMatching(/photo is saved/) });
  });

  it("refuses a malformed id", async () => {
    expect(await rejectDocumentReadingAction("x")).toMatchObject({ error: expect.any(String) });
    expect(rpc).not.toHaveBeenCalled();
  });
});
