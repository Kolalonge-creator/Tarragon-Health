import { loadMySecondOpinionRequests, submitSecondOpinionWithMaterial } from "./second-opinion";
import { supabase } from "./supabase";

jest.mock("./supabase", () => ({ supabase: { from: jest.fn(), rpc: jest.fn(), storage: { from: jest.fn() } } }));
const mockConfirm = jest.fn();
jest.mock("./api", () => ({ confirmDirectUpload: (...a: unknown[]) => mockConfirm(...a) }));

const mockFrom = supabase.from as unknown as jest.Mock;

/**
 * Regression test for the 2026-09-25 fix: `answerer` used to be embedded
 * directly (`clinical_staff!second_opinion_requests_answered_by_fkey`),
 * which silently returned null for every patient once
 * 20260925015430_restrict_clinical_staff_patient_read_to_safe_columns.sql
 * narrowed clinical_staff's own RLS. loadMySecondOpinionRequests now issues
 * a second, explicit query against clinical_staff_directory and merges the
 * result — mirrors apps/mobile/src/lib/messages.test.ts's pattern.
 */
function requestsTable(rows: unknown[]) {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  for (const method of ["select", "eq", "order", "limit"]) {
    builder[method] = () => builder;
  }
  return builder;
}

function directoryTable(rows: { id: string; full_name: string | null }[]) {
  let requestedIds: string[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: rows.filter((r) => requestedIds.includes(r.id)), error: null }).then(resolve),
  };
  builder.select = () => builder;
  builder.in = (_column: string, ids: string[]) => {
    requestedIds = ids;
    return builder;
  };
  return builder;
}

describe("loadMySecondOpinionRequests", () => {
  it("attaches the correct clinician answerer to each request", async () => {
    const requests = [
      { id: "r-1", patient_id: "p1", answered_by: "staff-a", created_at: "2026-09-01T00:00:00Z" },
      { id: "r-2", patient_id: "p1", answered_by: "staff-b", created_at: "2026-09-02T00:00:00Z" },
    ];
    const directory = [
      { id: "staff-a", full_name: "Dr. A" },
      { id: "staff-b", full_name: "Dr. B" },
    ];
    mockFrom.mockImplementation((table: string) =>
      table === "clinical_staff_directory" ? directoryTable(directory) : requestsTable(requests)
    );

    const result = await loadMySecondOpinionRequests("p1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].answerer?.full_name).toBe("Dr. A");
    expect(result.data[1].answerer?.full_name).toBe("Dr. B");
  });

  it("null-gates the answerer for an unanswered request", async () => {
    mockFrom.mockImplementation((table: string) =>
      table === "clinical_staff_directory"
        ? directoryTable([])
        : requestsTable([{ id: "r-1", patient_id: "p1", answered_by: null, created_at: "2026-09-01T00:00:00Z" }])
    );

    const result = await loadMySecondOpinionRequests("p1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].answerer).toBeNull();
  });
});

describe("submitSecondOpinionWithMaterial photos (security audit M-4/L-4)", () => {
  const mockRpc = supabase.rpc as unknown as jest.Mock;
  const mockStorage = supabase.storage.from as unknown as jest.Mock;

  function setUp(confirm: string | null) {
    mockFrom.mockReset();
    mockRpc.mockReset();
    mockConfirm.mockReset();
    mockConfirm.mockResolvedValue(confirm);
    const insertBuilder = { select: () => insertBuilder, single: async () => ({ data: { id: "req-1" }, error: null }) };
    mockFrom.mockReturnValue({ insert: () => insertBuilder });
    const upload = jest.fn().mockResolvedValue({ error: null });
    mockStorage.mockReturnValue({ upload });
    mockRpc.mockResolvedValue({ error: null });
    global.fetch = jest.fn().mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(10) }) as unknown as typeof fetch;
    return upload;
  }
  const input = { patientId: "u1", organisationId: "o1", existingDiagnosisOrResult: "x", sharedLabResultIds: [], photos: [{ uri: "file:///a.jpg", mimeType: "image/jpeg" }] };

  it("a photo the server refused is counted as failed and never attached to the request", async () => {
    const upload = setUp("That file is not what it says it is.");
    const r = await submitSecondOpinionWithMaterial(input);
    expect(r).toMatchObject({ ok: true, data: { filesFailed: 1 } });
    expect(mockConfirm).toHaveBeenCalledWith("second-opinion-documents", upload.mock.calls[0][0]);
    expect(mockRpc).not.toHaveBeenCalledWith("attach_second_opinion_document", expect.anything());
  });

  it("a checked photo (or no answer from the check) is attached", async () => {
    setUp(null);
    const r = await submitSecondOpinionWithMaterial(input);
    expect(r).toMatchObject({ ok: true, data: { filesFailed: 0 } });
    expect(mockRpc).toHaveBeenCalledWith("attach_second_opinion_document", expect.objectContaining({ p_request: "req-1" }));
  });
});
