/**
 * The skin photo retention job (S59b). Proves: refused without the cron secret; removes the file BEFORE marking the record purged;
 * a failed removal never marks the record (retry next run) and answers 500; idempotent when nothing is due; a list failure is loud.
 */
const captureException = jest.fn();
jest.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureException(...a) }));

const order: string[] = [];
let due: Array<{ id: string; storage_path: string }> = [];
let listError: { message: string } | null = null;
let removeError: { message: string } | null = null;
let markError: { message: string } | null = null;
const remove = jest.fn(async (paths: string[]) => {
  order.push(`remove:${paths[0]}`);
  return { error: removeError };
});
const rpc = jest.fn(async (fn: string, args?: { p_photo?: string }) => {
  if (fn === "skin_photos_due_for_purge") return { data: listError ? null : due, error: listError };
  order.push(`mark:${args?.p_photo}`);
  return { data: null, error: markError };
});
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ rpc, storage: { from: () => ({ remove }) } }),
}));

import { GET } from "./route";

const req = (secret?: string) => new Request("https://x.test/api/cron/skin-photo-purge", { headers: secret ? { authorization: `Bearer ${secret}` } : {} });

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
  order.length = 0;
  due = [];
  listError = removeError = markError = null;
  jest.clearAllMocks();
});

describe("skin photo purge cron", () => {
  it("refuses a request without the secret and touches nothing", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("wrong"))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("removes the file first, then marks the record", async () => {
    due = [{ id: "p1", storage_path: "u/p1.jpg" }];
    const res = await GET(req("s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ due: 1, removed: 1, failed: 0 });
    expect(order).toEqual(["remove:u/p1.jpg", "mark:p1"]);
  });

  it("never marks a record purged when the file could not be removed, and is loud", async () => {
    due = [{ id: "p1", storage_path: "u/p1.jpg" }];
    removeError = { message: "boom" };
    const res = await GET(req("s3cret"));
    expect(res.status).toBe(500);
    expect(order).toEqual(["remove:u/p1.jpg"]);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("reports a failed mark and keeps going with the next photo", async () => {
    due = [
      { id: "p1", storage_path: "u/p1.jpg" },
      { id: "p2", storage_path: "u/p2.jpg" },
    ];
    markError = { message: "nope" };
    const res = await GET(req("s3cret"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ due: 2, removed: 0, failed: 2 });
    expect(order).toEqual(["remove:u/p1.jpg", "mark:p1", "remove:u/p2.jpg", "mark:p2"]);
  });

  it("is a clean no-op when nothing is due (idempotent)", async () => {
    const res = await GET(req("s3cret"));
    expect(await res.json()).toEqual({ due: 0, removed: 0, failed: 0 });
    expect(remove).not.toHaveBeenCalled();
  });

  it("is loud when the due list cannot be read", async () => {
    listError = { message: "db down" };
    const res = await GET(req("s3cret"));
    expect(res.status).toBe(500);
    expect(captureException).toHaveBeenCalled();
  });
});
