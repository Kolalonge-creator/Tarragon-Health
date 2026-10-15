const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { loadWorkload } from "./load";

const good = { days: 30, generated_at: "2026-10-07T10:00:00Z", clinicians: [] };

beforeEach(() => rpc.mockReset());

describe("loadWorkload", () => {
  it("asks for the window and parses the answer", async () => {
    rpc.mockResolvedValue({ data: good, error: null });
    expect(await loadWorkload(7)).toEqual({ ok: true, data: good });
    expect(rpc).toHaveBeenCalledWith("clinician_workload_dashboard", { p_days: 7 });
  });
  it("a database error is a load failure, not an empty dashboard", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    expect(await loadWorkload(30)).toEqual({ ok: false, denied: false });
  });
  it("a refusal is reported as denied", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "no", code: "42501" } });
    expect(await loadWorkload(30)).toEqual({ ok: false, denied: true });
  });
  it("an answer that does not parse is a load failure", async () => {
    rpc.mockResolvedValue({ data: { days: 30 }, error: null });
    expect(await loadWorkload(30)).toEqual({ ok: false, denied: false });
  });
});
