const order: string[] = [];
const rpc = jest.fn();
const directRead = jest.fn();
const createSignedUrl = jest.fn();
let signedIn = true;

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: "u1" } : null } }) },
    rpc: (...a: unknown[]) => {
      order.push("rpc");
      return rpc(...a);
    },
    from: (table: string) => {
      order.push(`from:${table}`);
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = async () => directRead();
      return builder;
    },
  })),
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => {
    order.push("service");
    return { storage: { from: () => ({ createSignedUrl }) } };
  },
}));

import { GET } from "./route";

const id = "33333333-3333-4333-8333-333333333333";
const call = (attachment: string) =>
  GET(new Request(`http://x/api/care-messages/attachments/${attachment}`), {
    params: Promise.resolve({ attachmentId: attachment }),
  });

beforeEach(() => {
  order.length = 0;
  signedIn = true;
  rpc.mockReset();
  directRead.mockReset();
  createSignedUrl.mockReset().mockResolvedValue({ data: { signedUrl: "https://signed.example/file" } });
});

it("calls the audited open before the service client signs, and signs the returned path", async () => {
  rpc.mockResolvedValue({ data: "p1/file.png", error: null });
  const res = await call(id);
  expect(res.status).toBe(302);
  expect(res.headers.get("Location")).toBe("https://signed.example/file");
  expect(rpc).toHaveBeenCalledWith("open_care_attachment_audited", { p_attachment: id });
  expect(createSignedUrl).toHaveBeenCalledWith("p1/file.png", 300);
  expect(order.indexOf("rpc")).toBeGreaterThanOrEqual(0);
  expect(order.indexOf("rpc")).toBeLessThan(order.indexOf("service"));
  expect(order).not.toContain("from:care_message_attachments");
});

it("falls back to the direct row read on 42501 (supporter or break-glass reader)", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "not authorised" } });
  directRead.mockResolvedValue({ data: { file_path: "p2/other.png" } });
  const res = await call(id);
  expect(res.status).toBe(302);
  expect(createSignedUrl).toHaveBeenCalledWith("p2/other.png", 300);
  expect(order.indexOf("from:care_message_attachments")).toBeLessThan(order.indexOf("service"));
});

it("404s without signing when the fallback finds nothing", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "not authorised" } });
  directRead.mockResolvedValue({ data: null });
  const res = await call(id);
  expect(res.status).toBe(404);
  expect(order).not.toContain("service");
});

it("404s without signing when the attachment does not exist", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "not found" } });
  const res = await call(id);
  expect(res.status).toBe(404);
  expect(order).not.toContain("service");
});

it("surfaces any other RPC error as a failure, never falling back", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
  const res = await call(id);
  expect(res.status).toBe(500);
  expect(order).not.toContain("service");
  expect(order).not.toContain("from:care_message_attachments");
});

it("404s a malformed id without calling the database", async () => {
  const res = await call("not-a-uuid");
  expect(res.status).toBe(404);
  expect(rpc).not.toHaveBeenCalled();
});

it("401s when not signed in", async () => {
  signedIn = false;
  const res = await call(id);
  expect(res.status).toBe(401);
  expect(rpc).not.toHaveBeenCalled();
});
