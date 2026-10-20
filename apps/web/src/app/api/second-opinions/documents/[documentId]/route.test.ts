const order: string[] = [];
const rpc = jest.fn();
const createSignedUrl = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    rpc: (...a: unknown[]) => {
      order.push("rpc");
      return rpc(...a);
    },
  }),
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => {
    order.push("service");
    return {
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { storage_path: "p/q/r.pdf" } }) }) }) }),
      }),
      storage: { from: () => ({ createSignedUrl }) },
    };
  },
}));

import { GET } from "./route";

const request = "22222222-2222-4222-8222-222222222222";
const doc = "33333333-3333-4333-8333-333333333333";
const read = (docs: string[]) => ({
  id: request,
  patient_id: "44444444-4444-4444-8444-444444444444",
  status: "submitted",
  existing_diagnosis_or_result: "A result from another hospital",
  source_description: null,
  specific_question: null,
  documents: docs.map((id) => ({ id, mime_type: "application/pdf", size_bytes: 10 })),
  results: [],
});
const call = (documentId: string, r: string | null) =>
  GET(new Request(`http://x/api/second-opinions/documents/${documentId}${r ? `?request=${r}` : ""}`), {
    params: Promise.resolve({ documentId }),
  });

beforeEach(() => {
  order.length = 0;
  rpc.mockReset();
  createSignedUrl.mockReset().mockResolvedValue({ data: { signedUrl: "https://signed.example/file" } });
});

it("proves access with the audited read before the service client exists", async () => {
  rpc.mockResolvedValue({ data: read([doc]), error: null });
  const res = await call(doc, request);
  expect(res.status).toBe(302);
  expect(res.headers.get("Location")).toBe("https://signed.example/file");
  expect(res.headers.get("Cache-Control")).toContain("no-store");
  expect(order[0]).toBe("rpc");
  expect(order.indexOf("service")).toBeGreaterThan(order.indexOf("rpc"));
  expect(rpc).toHaveBeenCalledWith("read_second_opinion_audited", { p_request: request });
});

it("never touches the service client when the doctor is refused", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "request not found", code: "42501" } });
  const res = await call(doc, request);
  expect(res.status).toBe(404);
  expect(order).not.toContain("service");
});

it("404s a document the audited read did not list for this request", async () => {
  rpc.mockResolvedValue({ data: read(["55555555-5555-4555-8555-555555555555"]), error: null });
  const res = await call(doc, request);
  expect(res.status).toBe(404);
  expect(order).not.toContain("service");
});

it("rejects malformed ids before any database call", async () => {
  expect((await call("not-a-uuid", request)).status).toBe(404);
  expect((await call(doc, null)).status).toBe(404);
  expect(rpc).not.toHaveBeenCalled();
});
