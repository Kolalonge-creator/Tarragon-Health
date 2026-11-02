import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const getCurrentProfile = jest.fn<() => Promise<{ id: string } | null>>();
const getCallerPermissions = jest.fn<() => Promise<{ isSuperAdmin: boolean }>>();
const fdRpc = jest.fn<(s: unknown, fn: string, args: Record<string, unknown>) => Promise<{ error: string | null }>>();
const fdRpcData = jest.fn<(s: unknown, fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: string | null }>>();
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("server-only", () => ({}));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: () => getCurrentProfile() }));
jest.mock("@/lib/auth/permissions", () => ({ getCallerPermissions: () => getCallerPermissions() }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
jest.mock("@/lib/frontdesk/raw-db", () => ({
  fdRpc: (s: unknown, fn: string, a: Record<string, unknown>) => fdRpc(s, fn, a),
  fdRpcData: (s: unknown, fn: string, a?: Record<string, unknown>) => fdRpcData(s, fn, a),
}));

import { backToDryRunAction, goLiveAction, setMasterSwitchAction } from "./actions";

const form = (entries: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};

beforeEach(() => {
  jest.clearAllMocks();
  getCurrentProfile.mockResolvedValue({ id: "admin" });
  getCallerPermissions.mockResolvedValue({ isSuperAdmin: true });
  fdRpc.mockResolvedValue({ error: null });
  fdRpcData.mockImplementation(async (_s, fn) =>
    fn === "fd_followup_overview" ? { data: { approved_steps: 4, followups_enabled: true }, error: null } : { data: 3, error: null });
});

describe("follow-up console actions", () => {
  it("refuses anyone who is not a super admin and changes nothing", async () => {
    getCallerPermissions.mockResolvedValue({ isSuperAdmin: false });
    expect((await setMasterSwitchAction(undefined, form([["enabled", "true"]])))?.error).toMatch(/admin/i);
    expect((await goLiveAction(undefined, form([["confirm", "on"]])))?.error).toMatch(/admin/i);
    expect((await backToDryRunAction())?.error).toMatch(/admin/i);
    expect(fdRpc).not.toHaveBeenCalled();
  });

  it("sets the master switch through the validated config function", async () => {
    const r = await setMasterSwitchAction(undefined, form([["enabled", "false"]]));
    expect(r?.done).toBe("Follow-ups are off");
    expect(fdRpc).toHaveBeenCalledWith(expect.anything(), "fd_set_config", { p_key: "followups_enabled", p_value: false });
  });

  it("rejects a malformed switch value", async () => {
    expect((await setMasterSwitchAction(undefined, form([["enabled", "maybe"]])))?.error).toBe("Invalid request");
    expect(fdRpc).not.toHaveBeenCalled();
  });

  it("go live needs the confirmation box", async () => {
    expect((await goLiveAction(undefined, form([])))?.error).toMatch(/Tick the box/);
    expect(fdRpc).not.toHaveBeenCalled();
  });

  it("go live REFUSES when no email has been approved", async () => {
    fdRpcData.mockImplementation(async () => ({ data: { approved_steps: 0, followups_enabled: true }, error: null }));
    const r = await goLiveAction(undefined, form([["confirm", "on"]]));
    expect(r?.error).toMatch(/Approve wording first/);
    expect(fdRpc).not.toHaveBeenCalled();
  });

  it("go live REFUSES while the master switch is off", async () => {
    fdRpcData.mockImplementation(async () => ({ data: { approved_steps: 4, followups_enabled: false }, error: null }));
    expect((await goLiveAction(undefined, form([["confirm", "on"]])))?.error).toMatch(/Turn follow-ups on first/);
    expect(fdRpc).not.toHaveBeenCalled();
  });

  it("go live changes nothing when the current state cannot be read", async () => {
    fdRpcData.mockImplementation(async () => ({ data: null, error: "boom" }));
    expect((await goLiveAction(undefined, form([["confirm", "on"]])))?.error).toMatch(/nothing was changed/);
    expect(fdRpc).not.toHaveBeenCalled();
  });

  it("go live turns dry-run off, re-arms what was held back, and says how many", async () => {
    const r = await goLiveAction(undefined, form([["confirm", "on"]]));
    expect(fdRpc).toHaveBeenCalledWith(expect.anything(), "fd_set_config", { p_key: "followups_dry_run", p_value: false });
    expect(fdRpcData).toHaveBeenCalledWith(expect.anything(), "fd_rearm_dry_run_runs", undefined);
    expect(r?.done).toMatch(/3 held-back emails/);
  });

  it("back to dry-run sets dry-run true", async () => {
    expect((await backToDryRunAction())?.done).toMatch(/dry-run/);
    expect(fdRpc).toHaveBeenCalledWith(expect.anything(), "fd_set_config", { p_key: "followups_dry_run", p_value: true });
  });
});
