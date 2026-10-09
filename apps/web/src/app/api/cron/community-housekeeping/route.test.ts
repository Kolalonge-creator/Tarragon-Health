/** @jest-environment node */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
const rpc = jest.fn<Rpc>();
const remove = jest.fn<(paths: string[]) => Promise<{ error: { message: string } | null }>>();

jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ rpc, storage: { from: () => ({ remove }) } }),
}));

import { GET } from "./route";

const A = "44444444-4444-4444-8444-444444444444";
const B = "55555555-5555-4555-8555-555555555555";
const authorised = new Request("http://localhost/x", { headers: { authorization: "Bearer s3cret" } });

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
  rpc.mockReset();
  remove.mockReset();
});

describe("community housekeeping", () => {
  it("refuses a caller without the secret", async () => {
    expect((await GET(new Request("http://localhost/x"))).status).toBe(401);
    expect((await GET(new Request("http://localhost/x", { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("purges, removes due pictures then marks only the removed ones, and sends digests", async () => {
    rpc.mockImplementation(async (fn) => {
      if (fn === "community_purge_expired") return { data: 4, error: null };
      if (fn === "community_images_due") return { data: [{ id: A, path: "g/a.jpg" }, { id: B, path: "g/b.jpg" }], error: null };
      if (fn === "community_images_mark_deleted") return { data: 1, error: null };
      if (fn === "community_send_digests") return { data: 2, error: null };
      return { data: null, error: { message: "unexpected" } };
    });
    remove.mockImplementation(async ([p]) => (p === "g/b.jpg" ? { error: { message: "network down" } } : { error: null }));
    const res = await GET(authorised);
    expect(await res.json()).toMatchObject({ purged_posts: 4, images_due: 2, images_removed: 1, images_failed: 1, digests: 2 });
    expect(rpc).toHaveBeenCalledWith("community_images_mark_deleted", { p_ids: [A] });
  });

  it("treats a file that is already gone as removed", async () => {
    rpc.mockImplementation(async (fn) => {
      if (fn === "community_images_due") return { data: [{ id: A, path: "g/a.jpg" }], error: null };
      return { data: 0, error: null };
    });
    remove.mockResolvedValue({ error: { message: "Object not found" } });
    const body = await (await GET(authorised)).json();
    expect(body.images_failed).toBe(0);
    expect(rpc).toHaveBeenCalledWith("community_images_mark_deleted", { p_ids: [A] });
  });

  it("reports a failed step and keeps going", async () => {
    rpc.mockImplementation(async (fn) => (fn === "community_purge_expired" ? { data: null, error: { message: "x" } } : { data: [], error: null }));
    const res = await GET(authorised);
    expect(res.status).toBe(500);
    expect((await res.json()).errors).toContain("purge");
  });
});
