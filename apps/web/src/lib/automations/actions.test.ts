const rpc = jest.fn();
const redirect = jest.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { setAutomationPausedAction } from "./actions";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const goes = async (p: Promise<void>) => p.then(() => "no redirect", (e: Error) => e.message);
const good = { job_name: "care-circle-expiry", paused: "true", reason: "paused while the copy is reviewed" };

beforeEach(() => rpc.mockReset());

describe("setAutomationPausedAction", () => {
  it("passes the form on and says paused", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    expect(await goes(setAutomationPausedAction(fd(good)))).toBe("REDIRECT:/admin/ops/automations?n=paused");
    expect(rpc).toHaveBeenCalledWith("set_automation_paused", { p_job_name: "care-circle-expiry", p_paused: true, p_reason: good.reason });
  });
  it("resume says resumed", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    expect(await goes(setAutomationPausedAction(fd({ ...good, paused: "false", reason: "" })))).toBe("REDIRECT:/admin/ops/automations?n=resumed");
  });
  it.each([
    ["42501", "pause_denied"],
    ["23514", "pause_safety"],
    ["0A000", "pause_vercel"],
    ["22023", "reason_short"],
    ["XX000", "pause_failed"],
  ])("database error %s becomes the %s notice, never success", async (code, notice) => {
    rpc.mockResolvedValue({ data: null, error: { message: "x", code } });
    expect(await goes(setAutomationPausedAction(fd(good)))).toBe(`REDIRECT:/admin/ops/automations?n=${notice}`);
  });
  it("rejects a malformed form without calling the database", async () => {
    expect(await goes(setAutomationPausedAction(fd({ ...good, paused: "maybe" })))).toBe("REDIRECT:/admin/ops/automations?n=reason_short");
    expect(rpc).not.toHaveBeenCalled();
  });
});
