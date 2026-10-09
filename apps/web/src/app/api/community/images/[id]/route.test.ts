/** @jest-environment node */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const rpc = jest.fn<(fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>();
const download = jest.fn<(path: string) => Promise<{ data: Blob | null; error: unknown }>>();
let authenticated = true;

jest.mock("@/lib/community/api-auth", () => ({
  authenticateCommunity: async () =>
    authenticated ? { userId: "u", supabase: { rpc } } : { response: new Response("{}", { status: 401 }) },
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ storage: { from: () => ({ download }) } }),
}));

import { GET } from "./route";

const ID = "33333333-3333-4333-8333-333333333333";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = new Request("http://localhost/api/community/images/x");

beforeEach(() => {
  rpc.mockReset();
  download.mockReset();
  authenticated = true;
});

describe("GET /api/community/images/[id]", () => {
  it("answers 404 to something that is not an id, without asking the database", async () => {
    expect((await GET(req, ctx("not-a-uuid"))).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("needs a signed-in member", async () => {
    authenticated = false;
    expect((await GET(req, ctx(ID))).status).toBe(401);
  });

  it("answers 404 when the database says this person may not see it, and never touches storage", async () => {
    rpc.mockResolvedValue({ data: { ok: false, reason: "not_found" }, error: null });
    expect((await GET(req, ctx(ID))).status).toBe(404);
    expect(download).not.toHaveBeenCalled();
  });

  it("streams the bytes with no caching and a locked-down content policy", async () => {
    rpc.mockResolvedValue({ data: { ok: true, path: "g/f.jpg", mime: "image/jpeg" }, error: null });
    download.mockResolvedValue({ data: new Blob([Uint8Array.of(1, 2, 3)], { type: "image/jpeg" }), error: null });
    const res = await GET(req, ctx(ID));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect((await res.arrayBuffer()).byteLength).toBe(3);
  });

  it("answers 404 when the file is missing from storage", async () => {
    rpc.mockResolvedValue({ data: { ok: true, path: "g/f.jpg", mime: "image/png" }, error: null });
    download.mockResolvedValue({ data: null, error: { message: "not found" } });
    expect((await GET(req, ctx(ID))).status).toBe(404);
  });
});
