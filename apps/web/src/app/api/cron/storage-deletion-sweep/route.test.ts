/**
 * The storage deletion sweep (S5). Proves: refused without the cron secret; removes the file BEFORE marking the queue row done;
 * a failed removal records the error and never marks it done, and answers 500; idempotent when nothing is due; a list failure is loud.
 */
const captureException = jest.fn();
jest.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureException(...a) }));

const order: string[] = [];
let due: Array<{ id: string; bucket_id: string; name: string }> = [];
let listError: { message: string } | null = null;
let removeError: { message: string } | null = null;
let markError: { message: string } | null = null;
const remove = jest.fn(async (paths: string[]) => {
  order.push(`remove:${paths[0]}`);
  return { error: removeError };
});
const from = jest.fn(() => ({ remove }));
const rpc = jest.fn(async (fn: string, args?: { p_id?: string; p_error?: string }) => {
  if (fn === "storage_deletions_due") return { data: listError ? null : due, error: listError };
  order.push(args?.p_error ? `fail:${args.p_id}:${args.p_error}` : `done:${args?.p_id}`);
  return { data: null, error: markError };
});
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ rpc, storage: { from } }),
}));

import { GET } from "./route";

const req = (secret?: string) =>
  new Request("https://x.test/api/cron/storage-deletion-sweep", { headers: secret ? { authorization: `Bearer ${secret}` } : {} });

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
  order.length = 0;
  due = [];
  listError = removeError = markError = null;
  jest.clearAllMocks();
});

describe("storage deletion sweep cron", () => {
  it("refuses a request without the secret and touches nothing", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("wrong"))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("removes the file from its own bucket first, then marks the row done", async () => {
    due = [{ id: "q1", bucket_id: "ecg-reports", name: "u/a.png" }];
    const res = await GET(req("s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ due: 1, removed: 1, failed: 0 });
    expect(from).toHaveBeenCalledWith("ecg-reports");
    expect(order).toEqual(["remove:u/a.png", "done:q1"]);
  });

  it("never marks a row done when the file could not be removed: records the error, is loud, keeps going", async () => {
    due = [
      { id: "q1", bucket_id: "lab-result-documents", name: "u/a.pdf" },
      { id: "q2", bucket_id: "imaging-reports", name: "u/b.jpg" },
    ];
    removeError = { message: "boom" };
    const res = await GET(req("s3cret"));
    expect(res.status).toBe(500);
    expect(order).toEqual(["remove:u/a.pdf", "fail:q1:boom", "remove:u/b.jpg", "fail:q2:boom"]);
    expect(captureException).toHaveBeenCalledTimes(2);
    // ids only: the path (which carries a person's id folder) never goes to Sentry
    expect(JSON.stringify(captureException.mock.calls)).not.toContain("u/a.pdf");
  });

  it("reports a failure to record the error as well as the failed removal", async () => {
    due = [{ id: "q1", bucket_id: "lab-result-documents", name: "u/a.pdf" }];
    removeError = { message: "boom" };
    markError = { message: "db down" };
    const res = await GET(req("s3cret"));
    expect(res.status).toBe(500);
    expect(order).toEqual(["remove:u/a.pdf", "fail:q1:boom"]);
    expect(captureException).toHaveBeenCalledTimes(2);
    expect(String(captureException.mock.calls[1][0])).toMatch(/could not record the failure/);
  });

  it("does not count a removed file whose done mark failed, and is loud", async () => {
    due = [{ id: "q1", bucket_id: "ecg-reports", name: "u/a.png" }];
    markError = { message: "db down" };
    const res = await GET(req("s3cret"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ due: 1, removed: 0, failed: 1 });
  });

  it("is a quiet no-op when nothing is due", async () => {
    const res = await GET(req("s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ due: 0, removed: 0, failed: 0 });
    expect(remove).not.toHaveBeenCalled();
  });

  it("is loud when the due list cannot be read", async () => {
    listError = { message: "db down" };
    const res = await GET(req("s3cret"));
    expect(res.status).toBe(500);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });
});
