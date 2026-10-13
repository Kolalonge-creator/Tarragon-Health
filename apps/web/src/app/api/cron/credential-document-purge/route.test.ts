import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const rpc = jest.fn<(fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>>();
const remove = jest.fn<(paths: string[]) => Promise<{ error: { message: string } | null }>>();

jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ rpc, storage: { from: () => ({ remove }) } }),
}));

import { GET } from "./route";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const authed = () => new Request("https://x.test/api/cron/credential-document-purge", { headers: { authorization: "Bearer secret" } });

beforeEach(() => {
  rpc.mockReset();
  remove.mockReset();
  process.env.CRON_SECRET = "secret";
});

describe("credential document purge cron", () => {
  it("refuses a caller without the cron secret and touches nothing", async () => {
    const res = await GET(new Request("https://x.test/api/cron/credential-document-purge"));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does nothing when the database lists nothing (purge switched off or nothing due)", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    const res = await GET(authed());
    expect(await res.json()).toEqual({ due: 0, purged: 0, failed: 0 });
    expect(remove).not.toHaveBeenCalled();
  });

  it("removes the file first and the row second", async () => {
    rpc.mockResolvedValueOnce({ data: [{ document_id: ID_A, storage_path: "a/file.pdf", reason: "retention_elapsed" }], error: null });
    remove.mockResolvedValueOnce({ error: null });
    rpc.mockResolvedValueOnce({ data: null, error: null });
    const body = await (await GET(authed())).json();
    expect(body).toEqual({ due: 1, purged: 1, failed: 0 });
    expect(remove).toHaveBeenCalledWith(["a/file.pdf"]);
    expect(rpc).toHaveBeenLastCalledWith("purge_credential_document", { p_document: ID_A });
  });

  it("keeps the row when the file cannot be removed, so tomorrow retries", async () => {
    rpc.mockResolvedValueOnce({ data: [{ document_id: ID_A, storage_path: "a/file.pdf", reason: "retention_elapsed" }], error: null });
    remove.mockResolvedValueOnce({ error: { message: "storage unavailable" } });
    const body = await (await GET(authed())).json();
    expect(body).toEqual({ due: 1, purged: 0, failed: 1 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("treats a file that is already gone as removed and still records the purge", async () => {
    rpc.mockResolvedValueOnce({ data: [{ document_id: ID_B, storage_path: "b/file.pdf", reason: "rejected_application_retention_elapsed" }], error: null });
    remove.mockResolvedValueOnce({ error: { message: "Object not found" } });
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await (await GET(authed())).json()).toEqual({ due: 1, purged: 1, failed: 0 });
  });

  it("reports a listing failure as an error instead of a clean run", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect((await GET(authed())).status).toBe(500);
  });
});
