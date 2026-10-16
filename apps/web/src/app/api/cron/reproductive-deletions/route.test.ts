const rpcMock = jest.fn();
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: (...a: unknown[]) => rpcMock(...a) }) }));
import { GET } from "./route";

const req = (auth?: string) => new Request("http://x/api/cron/reproductive-deletions", { headers: auth ? { authorization: auth } : {} });

describe("reproductive deletions cron", () => {
  const old = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
    rpcMock.mockReset().mockResolvedValue({ data: 2, error: null });
  });
  afterAll(() => {
    process.env.CRON_SECRET = old;
  });
  it("refuses a call without the cron secret and runs nothing", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("runs the database processor and reports how many were completed", async () => {
    const res = await GET(req("Bearer s3cret"));
    expect(rpcMock).toHaveBeenCalledWith("process_due_reproductive_tracker_deletions");
    expect(await res.json()).toEqual({ ok: true, completed: 2 });
  });
  it("a failed run is a 500, never a quiet success", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(500);
  });
});
