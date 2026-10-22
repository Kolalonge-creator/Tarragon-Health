/**
 * Records from other hospitals on the phone (S09y): a failed read is a failure, never an empty list; a record reads "supplied by you, not yet checked"
 * unless a doctor's check is fully stamped; uploads obey the bucket's limits and clean up after a failed save.
 */
import { loadOutsideRecords, uploadOutsideRecord, OUTSIDE_RECORD_MAX_BYTES } from "./outside-records";
import { supabase } from "./supabase";

jest.mock("./supabase", () => ({ supabase: { from: jest.fn(), auth: { getUser: jest.fn() }, storage: { from: jest.fn() } } }));
const mockFrom = supabase.from as unknown as jest.Mock;
const getUser = supabase.auth.getUser as unknown as jest.Mock;
const storageFrom = supabase.storage.from as unknown as jest.Mock;

function builder(result: { data: unknown; error?: unknown }) {
  const b: Record<string, unknown> = { then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null, ...result }).then(res), maybeSingle: () => Promise.resolve({ error: null, ...result }) };
  for (const m of ["select", "eq", "in", "order", "limit"]) b[m] = () => b;
  return b;
}

beforeEach(() => {
  mockFrom.mockReset();
  getUser.mockReset();
  storageFrom.mockReset();
});

describe("loadOutsideRecords", () => {
  it("a read error is a failure, not an empty list", async () => {
    mockFrom.mockReturnValue(builder({ data: null, error: { message: "no" } }));
    expect(await loadOutsideRecords("p1")).toEqual({ ok: false });
  });

  it("labels each record from its stamp, and a half-stamped check never reads as checked", async () => {
    const rows = [
      { id: "a", document_type: "other", original_filename: "a.jpg", created_at: "2026-10-01T10:00:00Z", source: "patient", verification_status: "unchecked", reviewed_by: null, reviewed_at: null, review_note: null },
      { id: "b", document_type: "other", original_filename: "b.jpg", created_at: "2026-10-02T10:00:00Z", source: "patient", verification_status: "verified", reviewed_by: "doc1", reviewed_at: "2026-10-03T10:00:00Z", review_note: null },
      { id: "c", document_type: "other", original_filename: "c.jpg", created_at: "2026-10-02T10:00:00Z", source: "patient", verification_status: "verified", reviewed_by: null, reviewed_at: null, review_note: null },
    ];
    mockFrom.mockImplementation((name: string) => (name === "patient_documents" ? builder({ data: rows }) : builder({ data: [{ profile_id: "doc1", full_name: "Dr Ada Bello" }] })));
    const r = await loadOutsideRecords("p1");
    expect(r.ok && r.rows.map((x) => x.label.kind)).toEqual(["unchecked", "verified", "unchecked"]);
    const verified = r.ok ? r.rows[1].label : null;
    expect(verified).toMatchObject({ kind: "verified", reviewerName: "Dr Ada Bello" });
  });

  it("a failed staff-name lookup says 'your care team', never a guess", async () => {
    const rows = [{ id: "b", document_type: "other", original_filename: null, created_at: "2026-10-02T10:00:00Z", source: "patient", verification_status: "verified", reviewed_by: "doc1", reviewed_at: "2026-10-03T10:00:00Z", review_note: null }];
    mockFrom.mockImplementation((name: string) => (name === "patient_documents" ? builder({ data: rows }) : builder({ data: null, error: { message: "x" } })));
    const r = await loadOutsideRecords("p1");
    expect(r.ok && r.rows[0].label).toMatchObject({ kind: "verified", reviewerName: null });
  });
});

describe("uploadOutsideRecord", () => {
  const photo = { uri: "file:///x.jpg", mimeType: "image/jpeg", fileName: "x.jpg" };

  it("refuses a type or size the bucket would refuse, before touching the network", async () => {
    expect(await uploadOutsideRecord({ ...photo, mimeType: "text/html" }, "other")).toEqual({ ok: false, reason: "type" });
    expect(await uploadOutsideRecord({ ...photo, sizeBytes: OUTSIDE_RECORD_MAX_BYTES + 1 }, "other")).toEqual({ ok: false, reason: "too_big" });
    expect(getUser).not.toHaveBeenCalled();
  });

  it("removes the stored file when the row cannot be saved, so nothing is left that no one can see", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const upload = jest.fn().mockResolvedValue({ error: null });
    const remove = jest.fn().mockResolvedValue({ error: null });
    storageFrom.mockReturnValue({ upload, remove });
    mockFrom.mockImplementation((name: string) => (name === "profiles" ? builder({ data: { organisation_id: "org1" } }) : { insert: () => Promise.resolve({ error: { message: "rls" } }) }));
    global.fetch = jest.fn().mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(10) }) as unknown as typeof fetch;
    expect(await uploadOutsideRecord(photo, "other")).toEqual({ ok: false, reason: "insert" });
    expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0]]);
  });

  it("stores under the person's own folder and inserts a patient-sourced row with no review fields", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const upload = jest.fn().mockResolvedValue({ error: null });
    storageFrom.mockReturnValue({ upload, remove: jest.fn() });
    const insert = jest.fn().mockResolvedValue({ error: null });
    mockFrom.mockImplementation((name: string) => (name === "profiles" ? builder({ data: { organisation_id: "org1" } }) : { insert }));
    global.fetch = jest.fn().mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(10) }) as unknown as typeof fetch;
    Object.defineProperty(globalThis, "crypto", { value: { randomUUID: () => "11111111-1111-4111-8111-111111111111" }, configurable: true });
    expect(await uploadOutsideRecord(photo, "discharge_summary")).toEqual({ ok: true });
    expect(upload.mock.calls[0][0]).toBe("u1/11111111-1111-4111-8111-111111111111.jpg");
    const row = insert.mock.calls[0][0];
    expect(row).toMatchObject({ patient_id: "u1", source: "patient", document_type: "discharge_summary", ocr_state: null });
    expect(row).not.toHaveProperty("verification_status");
    expect(row).not.toHaveProperty("reviewed_by");
    expect(row).not.toHaveProperty("reviewed_at");
  });
});
