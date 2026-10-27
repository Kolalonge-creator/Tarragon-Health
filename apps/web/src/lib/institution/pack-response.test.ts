import { describe, expect, it, jest } from "@jest/globals";
import { packResponse } from "./pack-response";

const PACK = {
  sponsor: "Acme", generated_at: "2026-10-27T10:00:00Z", minimum_cell: 20, programmes: [], contracts: [], usage: [], configuration: null, privacy_ledger: [], methodology: "m",
};

function rpcWith(calls: string[], overrides: Record<string, { data?: unknown; error?: { message: string } | null }> = {}) {
  return (fn: string) => {
    calls.push(fn);
    const o = overrides[fn];
    if (o) return Promise.resolve({ data: o.data ?? null, error: o.error ?? null });
    if (fn === "sponsor_staff_programmes") return Promise.resolve({ data: { programmes: [{ id: "p1" }, { id: "p2" }] }, error: null });
    if (fn === "log_sponsor_staff_export") return Promise.resolve({ data: { ok: true }, error: null });
    return Promise.resolve({ data: PACK, error: null });
  };
}
const render = async () => new Uint8Array([1]);

describe("packResponse", () => {
  it("refuses a patient and a bad format before touching the database", async () => {
    const calls: string[] = [];
    expect((await packResponse({ role: "patient", format: "csv", rpc: rpcWith(calls), render })).status).toBe(403);
    expect((await packResponse({ role: "corporate_admin", format: "xml", rpc: rpcWith(calls), render })).status).toBe(400);
    expect(calls).toEqual([]);
  });
  it("logs every programme export before the pack is built", async () => {
    const calls: string[] = [];
    const res = await packResponse({ role: "hmo_admin", format: "csv", rpc: rpcWith(calls), render });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["sponsor_staff_programmes", "log_sponsor_staff_export", "log_sponsor_staff_export", "sponsor_procurement_pack"]);
    expect(res.headers.get("content-type")).toContain("text/csv");
  });
  it("gives no file when an export cannot be recorded", async () => {
    const calls: string[] = [];
    const res = await packResponse({ role: "corporate_admin", format: "pdf", rpc: rpcWith(calls, { log_sponsor_staff_export: { error: { message: "boom" } } }), render });
    expect(res.status).toBe(500);
    expect(calls).not.toContain("sponsor_procurement_pack");
  });
  it("renders a pdf through the injected renderer and says not found while the module is off", async () => {
    const spy = jest.fn(render);
    const ok = await packResponse({ role: "ngo_admin", format: "pdf", rpc: rpcWith([]), render: spy });
    expect(ok.headers.get("content-type")).toBe("application/pdf");
    expect(spy).toHaveBeenCalledTimes(1);
    const off = await packResponse({ role: "ngo_admin", format: "pdf", rpc: rpcWith([], { sponsor_procurement_pack: { error: { message: "x is built but not yet activated" } } }), render });
    expect(off.status).toBe(404);
  });
});
