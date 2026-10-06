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
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { storage_path: "p/q.jpg" } }) }) }) }),
      }),
      storage: { from: () => ({ createSignedUrl }) },
    };
  },
}));

import { GET } from "./route";

const consult = "22222222-2222-4222-8222-222222222222";
const photo = "33333333-3333-4333-8333-333333333333";
const question = (photos: string[]) => ({
  id: consult, patient_id: "44444444-4444-4444-8444-444444444444", category: "general", question: "q", duration_note: null,
  status: "submitted", task_id: null, window_due_at: null, safety_flagged: false, answer: null, answer_kind: null,
  created_at: "2026-10-06T10:00:00Z", photos: photos.map((id) => ({ id, mime_type: "image/jpeg", size_bytes: 10 })), messages: [],
});
const call = (attachment: string, c: string | null) =>
  GET(new Request(`http://x/api/written-questions/attachments/${attachment}${c ? `?consult=${c}` : ""}`), {
    params: Promise.resolve({ attachmentId: attachment }),
  });

beforeEach(() => {
  order.length = 0;
  rpc.mockReset();
  createSignedUrl.mockReset().mockResolvedValue({ data: { signedUrl: "https://signed.example/file" } });
});

it("proves access with the audited read before the service client exists", async () => {
  rpc.mockResolvedValue({ data: question([photo]), error: null });
  const res = await call(photo, consult);
  expect(res.status).toBe(302);
  expect(res.headers.get("Location")).toBe("https://signed.example/file");
  expect(res.headers.get("Cache-Control")).toContain("no-store");
  expect(order[0]).toBe("rpc");
  expect(order.indexOf("service")).toBeGreaterThan(order.indexOf("rpc"));
  expect(rpc).toHaveBeenCalledWith("read_written_question_audited", expect.objectContaining({ p_consult: consult }));
});

it("never touches the service client when the clinician holds no claim", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "queue_no_claim", code: "42501" } });
  const res = await call(photo, consult);
  expect(res.status).toBe(404);
  expect(order).not.toContain("service");
});

it("404s a photo the audited read did not list for this question", async () => {
  rpc.mockResolvedValue({ data: question(["55555555-5555-4555-8555-555555555555"]), error: null });
  const res = await call(photo, consult);
  expect(res.status).toBe(404);
  expect(order).not.toContain("service");
});

it("rejects malformed ids before any database call", async () => {
  expect((await call("not-a-uuid", consult)).status).toBe(404);
  expect((await call(photo, null)).status).toBe(404);
  expect(rpc).not.toHaveBeenCalled();
});
