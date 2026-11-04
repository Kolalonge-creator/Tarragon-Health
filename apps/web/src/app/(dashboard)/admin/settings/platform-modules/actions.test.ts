/**
 * Regression (2026-11-04): the action only accepted the first two module keys (payer_platform, provider_org_platform), so every later
 * module listed on this page (Care Circle digest, tasks, nudge, ...) was refused with "Invalid option", shown at the top of a long page.
 * The database function set_platform_module is the authority; the action must pass any well-formed key through to it.
 */
const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { setPlatformModuleAction } from "./actions";

function form(key: string, enabled: string, note?: string) {
  const f = new FormData();
  f.set("key", key);
  f.set("enabled", enabled);
  if (note) f.set("note", note);
  return f;
}

describe("setPlatformModuleAction", () => {
  beforeEach(() => rpc.mockReset());

  it("passes a module added after the first two (care_circle_digest) to the database", async () => {
    rpc.mockResolvedValue({ error: null });
    const r = await setPlatformModuleAction(undefined, form("care_circle_digest", "true", "Founder decision"));
    expect(rpc).toHaveBeenCalledWith("set_platform_module", { p_key: "care_circle_digest", p_enabled: true, p_note: "Founder decision" });
    expect(r).toEqual({ message: "care_circle_digest activated." });
  });

  it("still works for the original modules", async () => {
    rpc.mockResolvedValue({ error: null });
    await setPlatformModuleAction(undefined, form("payer_platform", "false"));
    expect(rpc).toHaveBeenCalledWith("set_platform_module", { p_key: "payer_platform", p_enabled: false, p_note: undefined });
  });

  it("refuses a malformed key before calling the database", async () => {
    const r = await setPlatformModuleAction(undefined, form("Robert'); drop table", "true", "x"));
    expect(rpc).not.toHaveBeenCalled();
    expect(r?.error).toBeTruthy();
  });

  it("returns the database's refusal (e.g. not a superadmin) as the error", async () => {
    rpc.mockResolvedValue({ error: { message: "only a superadmin may switch a platform module" } });
    const r = await setPlatformModuleAction(undefined, form("care_circle_tasks", "true", "x"));
    expect(r).toEqual({ error: "only a superadmin may switch a platform module" });
  });
});
