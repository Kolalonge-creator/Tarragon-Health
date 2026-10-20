/**
 * The replace is now a database function (public.replace_my_result_document) that supersedes the document. The route must:
 *  - call it with the new object's path and run re-extraction against the NEW document id, never the old one;
 *  - never remove the OLD file;
 *  - remove the newly uploaded object only when the database clearly refused, not after an ambiguous failure (a timeout may follow a commit).
 */
const rpc = jest.fn();
const removeMock = jest.fn().mockResolvedValue({ error: null });
const uploadMock = jest.fn().mockResolvedValue({ error: null });
const extraction = jest.fn().mockResolvedValue(undefined);

jest.mock("@/lib/supabase/bearer", () => ({
  createBearerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "patient-1" } }, error: null }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: "doc-old", patient_id: "patient-1", organisation_id: "org-1", source: "patient", reviewed_at: null, file_path: "patient-1/old.pdf" },
          }),
        }),
      }),
    }),
    storage: { from: () => ({ upload: uploadMock, remove: removeMock }) },
    rpc,
  }),
}));
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
jest.mock("@/lib/lab-reports/extraction-actions", () => ({ runLabReportExtraction: (...args: unknown[]) => extraction(...args) }));

import { POST } from "./route";

function request(): Request {
  const form = new FormData();
  form.append("document_id", "11111111-1111-4111-8111-111111111111");
  form.append("file", new File([new Uint8Array([1, 2, 3])], "new.pdf", { type: "application/pdf" }));
  return new Request("http://localhost/api/mobile/lab-result-replace", {
    method: "POST",
    headers: { authorization: "Bearer token" },
    body: form,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  removeMock.mockResolvedValue({ error: null });
  uploadMock.mockResolvedValue({ error: null });
});

describe("POST /api/mobile/lab-result-replace", () => {
  it("supersedes through the database function and re-reads the NEW document, keeping the old file", async () => {
    rpc.mockResolvedValue({ data: "doc-new", error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("replace_my_result_document", expect.objectContaining({ p_document_id: "11111111-1111-4111-8111-111111111111" }));
    expect(extraction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ documentId: "doc-new" }));
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("removes only the new object when the database clearly refuses", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "55000", message: "already replaced" } });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(removeMock).toHaveBeenCalledTimes(1);
    const removed = removeMock.mock.calls[0][0] as string[];
    expect(removed).toHaveLength(1);
    expect(removed[0]).not.toBe("patient-1/old.pdf");
    expect(extraction).not.toHaveBeenCalled();
  });

  it("keeps the new object after an ambiguous failure, because the replace may have committed", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "57014", message: "timeout" } });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(removeMock).not.toHaveBeenCalled();
  });
});
