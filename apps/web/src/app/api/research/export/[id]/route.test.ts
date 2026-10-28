const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { GET } from "./route";
const ID = "11111111-1111-4111-8111-111111111111";
const call = () => GET(new Request("http://x"), { params: Promise.resolve({ id: ID }) });
beforeEach(() => rpc.mockReset());

describe("GET /api/research/export/[id]", () => {
  it("answers 409 needs_authorisation when no second person has authorised", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "55000", message: "a second person must authorise this export first (request it)" } });
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "needs_authorisation" });
  });
  it("answers 409 held_back when the release differs too little from the last one", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "55000", message: "held back: this release differs from the previous one by fewer than 20 people" } });
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "held_back" });
  });
  it("answers 403 when the caller is not allowed", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "not authorised" } });
    expect((await call()).status).toBe(403);
  });
  it("returns a CSV only when the database released rows", async () => {
    rpc.mockResolvedValue({ data: { export_id: ID, fields: ["day"], rows: [{ participant: "p1", day: 3 }], sha256: "a".repeat(64) }, error: null });
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe("participant,day\r\np1,3\r\n");
  });
});
