/** S04b-2 on mobile: consent receipts, optional-only give/withdraw with a "mobile" channel, deletion requests with a grace period and cancel. */
const mockInsert = jest.fn();
const mockRpc = jest.fn();
let mockVersionRow: { id: string; version: string; is_optional: boolean } | null;
let mockReceiptRows: unknown[] = [];
let mockListFails = false;

jest.mock("./supabase", () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: (table: string) => {
      if (table === "consent_versions") {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mockVersionRow, error: null }) }) }) }) };
      }
      if (table === "patient_consent_receipts") {
        return { select: () => ({ eq: () => ({ order: async () => ({ data: mockReceiptRows, error: null }) }) }) };
      }
      if (table === "data_deletion_requests" && mockListFails) {
        return {
          select: () => ({ eq: () => ({ order: async () => ({ data: null, error: { message: "offline" } }) }) }),
          insert: (row: unknown) => mockInsert(table, row),
        };
      }
      return { insert: (row: unknown) => mockInsert(table, row) };
    },
  },
}));

import { cancelDeletionRequest, createDeletionRequest, loadConsentReceipts, loadDeletionRequests, recordConsent } from "./privacy";

beforeEach(() => {
  mockInsert.mockReset().mockResolvedValue({ error: null });
  mockRpc.mockReset().mockResolvedValue({ error: null });
  mockVersionRow = { id: "cv-1", version: "v1", is_optional: true };
  mockReceiptRows = [];
  mockListFails = false;
});

describe("recordConsent", () => {
  it("appends one row for one optional purpose and records the mobile channel", async () => {
    const result = await recordConsent("org-1", "p1", "research", "accepted", "cv-1");
    expect(result.ok).toBe(true);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledWith("patient_consents", {
      organisation_id: "org-1",
      patient_id: "p1",
      consent_type: "research",
      consent_version_id: "cv-1",
      version: "v1",
      action: "accepted",
      channel: "mobile",
    });
  });

  it("tells the person to refresh when the wording changed while they were reading (database refusal)", async () => {
    mockInsert.mockResolvedValue({ error: { code: "23514", message: "replaced" } });
    const result = await recordConsent("org-1", "p1", "research", "accepted", "cv-1");
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/wording changed/i) });
  });

  it("refuses a required purpose before writing anything", async () => {
    mockVersionRow = { id: "cv-2", version: "v1", is_optional: false };
    const result = await recordConsent("org-1", "p1", "data_processing", "withdrawn");
    expect(result.ok).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("explains a database refusal of a required withdrawal instead of saying try again", async () => {
    mockInsert.mockResolvedValue({ error: { code: "23514", message: "required" } });
    const result = await recordConsent("org-1", "p1", "research", "withdrawn");
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/close your account/i) });
  });

  it("finds nothing to give when no published version exists (drafts are invisible to the patient)", async () => {
    mockVersionRow = null;
    const result = await recordConsent("org-1", "p1", "care_circle_sharing", "accepted");
    expect(result.ok).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe("deletion requests", () => {
  it("send a grace_ends_at about 14 days out", async () => {
    await createDeletionRequest("org-1", "p1", "leaving");
    const [table, row] = mockInsert.mock.calls[0] as [string, { grace_ends_at: string }];
    expect(table).toBe("data_deletion_requests");
    const days = (Date.parse(row.grace_ends_at) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
  });

  it("cancel goes through the database function and surfaces a refusal", async () => {
    expect((await cancelDeletionRequest("d1")).ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("cancel_my_data_deletion_request", { p_request: "d1" });
    mockRpc.mockResolvedValue({ error: { message: "The waiting period for this deletion request has ended" } });
    const refused = await cancelDeletionRequest("d1");
    expect(refused.ok).toBe(false);
  });
});

describe("a failed load is not an empty list", () => {
  it("loadDeletionRequests reports the error instead of returning [] (which would hide a pending request and its cancel button)", async () => {
    mockListFails = true;
    const result = await loadDeletionRequests("p1");
    expect(result.ok).toBe(false);
  });

  it("a second open request gets a plain message, not a constraint name", async () => {
    mockInsert.mockResolvedValue({ error: { code: "23505", message: 'duplicate key value violates unique constraint "data_deletion_requests_one_open_per_patient"' } });
    const result = await createDeletionRequest("org-1", "p1", "again");
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/already have a request in progress/i) });
  });
});

describe("loadConsentReceipts", () => {
  it("marks a row recorded before receipts as legacy with no fingerprint, without guessing", async () => {
    mockReceiptRows = [{ id: "r1", consent_type: "research", action: "accepted", version: "v1", title: "T", body: "B", channel: null, consented_by_relation: null, recorded_at: "2026-10-01T10:00:00Z", text_sha256: null }];
    const result = await loadConsentReceipts("p1");
    if (!result.ok) throw new Error("expected ok");
    expect(result.data[0]).toMatchObject({ channel: "unknown", consented_by_relation: "legacy", text_sha256: null });
  });
});
