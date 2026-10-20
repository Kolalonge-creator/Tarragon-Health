import {
  DOCUMENT_CAPTURE_GUARD,
  confirmFields,
  firstBlankKept,
  isReadingOpen,
  requestReading,
  loadDocumentDetail,
  loadDocuments,
  parseDocumentList,
  parseSuggestedFields,
  rejectReading,
  saveDocument,
  type SaveDocumentInput,
} from "./capture";

let mockGuard: { data: unknown; error: unknown } = { data: false, error: null };
let mockUploadError: { message: string; statusCode?: string } | null = null;
let mockInsertError: { code?: string; message: string } | null = null;
let mockRpcError: { message: string } | null = null;
let mockListError: { message: string } | null = null;
let mockDetail: { data: unknown; error: unknown } = { data: null, error: null };
const mockInserts: Record<string, unknown>[] = [];
const mockUploads: { path: string; opts: unknown }[] = [];
const mockSelects: string[] = [];
const mockRpcs: { fn: string; args: Record<string, unknown> }[] = [];
const mockPost = jest.fn();

const mockRemoves: string[][] = [];
jest.mock("../api", () => ({ postDocumentReading: (...a: unknown[]) => mockPost(...a) }));
jest.mock("../supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      mockRpcs.push({ fn, args });
      if (fn === "go_live_guard_is_open") return mockGuard;
      return mockRpcError ? { data: null, error: mockRpcError } : { data: { kept: 2 }, error: null };
    },
    storage: {
      from: () => ({
        upload: async (path: string, _bytes: unknown, opts: unknown) => {
          mockUploads.push({ path, opts });
          return { error: mockUploadError };
        },
        remove: async (paths: string[]) => {
          mockRemoves.push(paths);
          return { data: null, error: null };
        },
        createSignedUrl: async () => ({ data: { signedUrl: "https://signed.example/photo" }, error: null }),
      }),
    },
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        mockInserts.push(row);
        return { error: mockInsertError };
      },
      select: (cols: string) => {
        mockSelects.push(cols);
        const q: Record<string, unknown> = {
          eq: () => q,
          order: () => q,
          limit: () => q,
          maybeSingle: async () => mockDetail,
          then: (res: (v: unknown) => unknown) =>
            res(mockListError ? { data: null, error: mockListError } : { data: [{ id: "d1", document_type: "prescription", original_filename: "a.jpg", created_at: "2026-10-01T10:00:00Z", ocr_state: "suggested", mime_type: "image/jpeg", extracted: { fields: [{ key: "x" }] }, ocr_text: "secret" }], error: null }),
        };
        return q;
      },
    }),
  },
}));

const ID = "11111111-1111-4111-8111-111111111111";
const input: SaveDocumentInput = { userId: "user-1", organisationId: "org-1", attemptId: ID, type: "prescription", bytes: Uint8Array.from([1, 2, 3]), mime: "image/jpeg", filename: "scan.jpg" };

beforeEach(() => {
  mockGuard = { data: false, error: null };
  mockUploadError = null;
  mockInsertError = null;
  mockRpcError = null;
  mockListError = null;
  mockDetail = { data: null, error: null };
  mockInserts.length = 0;
  mockRemoves.length = 0;
  mockUploads.length = 0;
  mockSelects.length = 0;
  mockRpcs.length = 0;
  mockPost.mockReset().mockResolvedValue({ ok: true, status: "suggested", message: "" });
});

describe("photo capture on the phone (S43m)", () => {
  it("reading is open only when the guard answers true: an error or a refusal counts as closed", async () => {
    expect(await isReadingOpen()).toBe(false);
    mockGuard = { data: true, error: null };
    expect(await isReadingOpen()).toBe(true);
    mockGuard = { data: true, error: { message: "denied" } };
    expect(await isReadingOpen()).toBe(false);
    mockGuard = { data: "true", error: null };
    expect(await isReadingOpen()).toBe(false);
    expect(mockRpcs.every((c) => c.fn === "go_live_guard_is_open" && c.args.p_key === DOCUMENT_CAPTURE_GUARD)).toBe(true);
  });

  it("with the guard closed the photo is saved as a plain upload: nothing waits for a reading and none is asked for", async () => {
    const r = await saveDocument(input);
    expect(r).toEqual({ ok: true, documentId: ID, reading: "closed" });
    expect(mockInserts[0]).toMatchObject({ id: ID, patient_id: "user-1", organisation_id: "org-1", source: "patient", ocr_state: null, mime_type: "image/jpeg", file_path: `user-1/${ID}.jpg` });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("a guard that cannot be read is not 'closed': the photo is marked waiting and the SERVER decides (it checks the guard before any model)", async () => {
    mockGuard = { data: null, error: { message: "Network request failed" } };
    mockPost.mockResolvedValue({ ok: true, status: "closed", message: "Reading from photos is not open yet. Your photo is saved." });
    const r = await saveDocument(input);
    expect(r).toEqual({ ok: true, documentId: ID, reading: "closed" });
    expect(mockInserts[0].ocr_state).toBe("pending");
    expect(mockPost).toHaveBeenCalledWith(ID);
    expect(await isReadingOpen()).toBe(false);
  });

  it("the server saying closed is never reported as a reading being asked for", async () => {
    mockGuard = { data: true, error: null };
    mockPost.mockResolvedValue({ ok: true, status: "closed", message: "" });
    expect(await saveDocument(input)).toMatchObject({ reading: "closed" });
    expect(await requestReading(ID)).toEqual({ outcome: "closed" });
    mockPost.mockResolvedValue({ ok: true, status: "not_pending", message: "" });
    expect(await requestReading(ID)).toEqual({ outcome: "saved" });
    mockPost.mockResolvedValue({ ok: true, status: "suggested", message: "" });
    expect(await requestReading(ID)).toEqual({ outcome: "asked" });
  });

  it("no answer from the server is 'unknown' (it may be running), not a failure to ask and not a lost connection", async () => {
    mockGuard = { data: true, error: null };
    mockPost.mockResolvedValue({ ok: false, offline: false, unknown: true });
    expect(await saveDocument(input)).toMatchObject({ ok: true, reading: "unknown" });
    mockPost.mockResolvedValue({ ok: false, offline: false, unknown: false });
    expect(await saveDocument({ ...input, attemptId: "33333333-3333-4333-8333-333333333333" })).toMatchObject({ reading: "failed" });
  });

  it("with the guard open the photo waits for a reading and one is asked for, and a refused ask still keeps the photo", async () => {
    mockGuard = { data: true, error: null };
    expect(await saveDocument(input)).toEqual({ ok: true, documentId: ID, reading: "asked" });
    expect(mockInserts[0].ocr_state).toBe("pending");
    expect(mockPost).toHaveBeenCalledWith(ID);
    mockPost.mockResolvedValue({ ok: false, offline: false, unknown: false });
    expect(await saveDocument({ ...input, attemptId: "22222222-2222-4222-8222-222222222222" })).toMatchObject({ ok: true, reading: "failed" });
  });

  it("uploads under the person's own folder with the file's real type, and a PDF keeps its extension", async () => {
    await saveDocument({ ...input, mime: "application/pdf", filename: "report.pdf" });
    expect(mockUploads[0]).toEqual({ path: `user-1/${ID}.pdf`, opts: { contentType: "application/pdf", upsert: false } });
  });

  it("a retry after a lost answer makes no second document: an object or row that already exists counts as done", async () => {
    mockUploadError = { message: "The resource already exists", statusCode: "409" };
    mockInsertError = { code: "23505", message: "duplicate key" };
    mockGuard = { data: true, error: null };
    expect(await saveDocument(input)).toEqual({ ok: true, documentId: ID, reading: "saved" });
    // the earlier attempt landed, so a reading is not asked for a second time
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("a failed save removes the file it just uploaded, so no unlisted document is left in the bucket", async () => {
    mockInsertError = { code: "42501", message: "denied" };
    await saveDocument(input);
    expect(mockRemoves).toEqual([[`user-1/${ID}.jpg`]]);
    mockRemoves.length = 0;
    mockInsertError = null;
    mockUploadError = { message: "The resource already exists", statusCode: "409" };
    mockInsertError = { code: "500", message: "boom" };
    await saveDocument(input);
    expect(mockRemoves).toEqual([]); // a file an earlier attempt uploaded is not this attempt's to remove
  });

  it("says offline for a lost connection and failed for anything else, and never inserts a row for a failed upload", async () => {
    mockUploadError = { message: "Network request failed" };
    expect(await saveDocument(input)).toEqual({ ok: false, reason: "offline" });
    expect(mockInserts).toHaveLength(0);
    mockUploadError = { message: "Payload too large", statusCode: "413" };
    expect(await saveDocument(input)).toEqual({ ok: false, reason: "failed" });
    mockUploadError = null;
    mockInsertError = { code: "42501", message: "denied" };
    expect(await saveDocument(input)).toEqual({ ok: false, reason: "failed" });
  });

  it("refuses a document type that is not on the list", async () => {
    expect(await saveDocument({ ...input, type: "lab_secret" as never })).toEqual({ ok: false, reason: "bad_type" });
    expect(mockUploads).toHaveLength(0);
  });

  it("the saved list asks only for metadata and never holds anything read from a document", async () => {
    const r = await loadDocuments("user-1");
    expect(mockSelects[0]).not.toMatch(/extracted|ocr_text/);
    expect(JSON.stringify(r)).not.toMatch(/secret|extracted|ocr_text|fields/);
    expect(r.ok && r.data[0]).toEqual({ id: "d1", documentType: "prescription", filename: "a.jpg", createdAt: "2026-10-01T10:00:00Z", ocrState: "suggested", isPdf: false });
    mockListError = { message: "Network request failed" };
    const offline = await loadDocuments("user-1");
    expect(offline.ok && offline.stale).toBe(true);
    expect(JSON.stringify(offline)).not.toMatch(/secret|extracted|ocr_text/);
  });

  it("ignores malformed list rows and unknown states", () => {
    expect(parseDocumentList([{ id: 1 }, null, { id: "a", created_at: "2026-01-01T00:00:00Z", document_type: "other", ocr_state: "weird" }])).toEqual([
      { id: "a", documentType: "other", filename: null, createdAt: "2026-01-01T00:00:00Z", ocrState: null, isPdf: false },
    ]);
  });

  it("reads suggestions live and keeps only well-formed ones", () => {
    expect(
      parseSuggestedFields({
        fields: [
          { key: "hb", label: "Haemoglobin", value: "12.1", unit: "g/dL", confidence: "high" },
          { key: "", label: "x", value: "y", confidence: "low" },
          { key: "k", label: "No value" },
          { key: "w", label: "Odd confidence", value: "1", confidence: "certain" },
        ],
      })
    ).toEqual([
      { key: "hb", label: "Haemoglobin", value: "12.1", unit: "g/dL", confidence: "high" },
      { key: "w", label: "Odd confidence", value: "1", unit: null, confidence: "low" },
    ]);
    expect(parseSuggestedFields(null)).toEqual([]);
    expect(parseSuggestedFields({ fields: "no" })).toEqual([]);
  });

  it("opening one document gives its details and a short-lived link, or null: never an empty document", async () => {
    mockDetail = { data: { extracted: { fields: [{ key: "hb", label: "Hb", value: "12", confidence: "medium" }] }, file_path: "user-1/a.jpg", mime_type: "image/jpeg" }, error: null };
    const d = await loadDocumentDetail("d1");
    expect(d).toMatchObject({ isPdf: false, photoUrl: "https://signed.example/photo" });
    expect(d?.fields).toHaveLength(1);
    mockDetail = { data: null, error: { message: "Network request failed" } };
    expect(await loadDocumentDetail("d1")).toBeNull();
    mockDetail = { data: null, error: null };
    expect(await loadDocumentDetail("d1")).toBeNull();
  });

  describe("confirming and rejecting", () => {
    const fields = [
      { key: "hb", label: "Haemoglobin", value: "12.1", unit: "g/dL", confidence: "high" as const },
      { key: "wbc", label: "WBC", value: "6", unit: null, confidence: "low" as const },
    ];

    it("finds a kept detail whose value was cleared (it would be confirmed as the original reading)", () => {
      expect(firstBlankKept(fields, [{ key: "hb", accept: true, value: "  " }])?.key).toBe("hb");
      expect(firstBlankKept(fields, [{ key: "hb", accept: true }])).toBeNull();
      expect(firstBlankKept(fields, [{ key: "hb", accept: false, value: "" }])).toBeNull();
      expect(firstBlankKept(fields, [{ key: "hb", accept: true, value: "12" }])).toBeNull();
    });

    it("will not send a confirm until at least one detail is kept", async () => {
      expect(await confirmFields("d1", fields, [])).toEqual({ ok: false, reason: "none_accepted" });
      expect(await confirmFields("d1", fields, [{ key: "hb", accept: false }])).toEqual({ ok: false, reason: "none_accepted" });
      expect(mockRpcs).toHaveLength(0);
    });

    it("sends only what the person decided, with their edit, and no key the suggestion did not have", async () => {
      const r = await confirmFields("d1", fields, [
        { key: "hb", accept: true, value: "12.4" },
        { key: "wbc", accept: false },
        { key: "invented", accept: true },
      ]);
      expect(r).toEqual({ ok: true, kept: 2 });
      expect(mockRpcs[0]).toEqual({ fn: "confirm_document_extraction", args: { p_document: "d1", p_fields: [{ key: "hb", accept: true, value: "12.4" }, { key: "wbc", accept: false }] } });
    });

    it("maps the database's refusals to plain reasons", async () => {
      mockRpcError = { message: "Network request failed" };
      expect(await confirmFields("d1", fields, [{ key: "hb", accept: true }])).toEqual({ ok: false, reason: "offline" });
      mockRpcError = { message: "nothing waiting to confirm" };
      expect(await confirmFields("d1", fields, [{ key: "hb", accept: true }])).toEqual({ ok: false, reason: "not_waiting" });
      mockRpcError = { message: "boom" };
      expect(await confirmFields("d1", fields, [{ key: "hb", accept: true }])).toEqual({ ok: false, reason: "failed" });
    });

    it("a rejected reading calls the rejecting function, which leaves the photo and nothing else", async () => {
      expect(await rejectReading("d1")).toEqual({ ok: true });
      expect(mockRpcs[0]).toEqual({ fn: "reject_document_extraction", args: { p_document: "d1" } });
      mockRpcError = { message: "Network request failed" };
      expect(await rejectReading("d1")).toEqual({ ok: false, reason: "offline" });
    });
  });
});
