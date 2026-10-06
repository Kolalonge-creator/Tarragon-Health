import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { PROPOSED_CONFIG, getProposedConfig } from "@tarragon/shared";
import { hashConfigValue } from "./model";

type RpcResult = Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
const rpc = jest.fn<(fn: string, args?: Record<string, unknown>) => RpcResult>();
const serviceRpc = jest.fn<(fn: string, args?: Record<string, unknown>) => RpcResult>();
const flash = jest.fn<(f: { notice: string; detail?: string; ok: boolean }) => Promise<void>>();
let role: string | null = "admin";
let cmo = false;
let signedIn = true;

jest.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("./flash", () => ({ setFlash: async (f: { notice: string; detail?: string; ok: boolean }) => { await flash(f); return "n-1"; } }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc, auth: { getUser: async () => ({ data: { user: signedIn ? { id: "signer-1" } : null } }) } }),
}));
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: serviceRpc }) }));
jest.mock("@/lib/auth/current-profile", () => ({
  getCurrentProfile: async () => (role ? { role } : null),
  getCurrentClinicalStaff: async () => (cmo ? { doctor_tier: "chief_medical_officer", active: true } : null),
}));

import { attestConditionAction, signoffConfigAction, switchGuardAction } from "./actions";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
/** The path the action redirected to ("" when it did not redirect). */
const run = async (p: Promise<void>): Promise<string> => {
  try {
    await p;
    return "no redirect";
  } catch (e) {
    return (e as Error).message;
  }
};

beforeEach(() => {
  rpc.mockReset();
  serviceRpc.mockReset();
  flash.mockReset();
  rpc.mockResolvedValue({ data: { ok: true }, error: null });
  serviceRpc.mockResolvedValue({ data: { ok: true }, error: null });
  role = "admin";
  cmo = false;
  signedIn = true;
});

describe("switchGuardAction", () => {
  it("sends a person back to the front page, with no database call, when they are not the viewer they claim to be", async () => {
    role = "patient";
    expect(await run(switchGuardAction(form({ viewer: "admin", key: "payouts_enabled", on: "1", note: "x" })))).toBe("REDIRECT:/");
    expect(await run(switchGuardAction(form({ viewer: "cmo", key: "payouts_enabled", on: "1", note: "x" })))).toBe("REDIRECT:/");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a key that is not one of the seven guards before calling the database", async () => {
    const msg = await run(switchGuardAction(form({ viewer: "admin", key: "made_up", on: "1", note: "x" })));
    expect(msg).toBe("REDIRECT:/admin/go-live?n=n-1");
    expect(flash).toHaveBeenCalledWith(expect.objectContaining({ notice: "golive.error.input", ok: false }));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls the one switching function and reports success in a one-shot notice, not in the address", async () => {
    const msg = await run(switchGuardAction(form({ viewer: "admin", key: "payouts_enabled", on: "1", confirm: "on", note: "ready" })));
    expect(rpc).toHaveBeenCalledWith("set_go_live_guard", { p_key: "payouts_enabled", p_on: true, p_note: "ready" });
    expect(msg).toBe("REDIRECT:/admin/go-live?n=n-1");
    expect(flash).toHaveBeenCalledWith({ notice: "golive.done.switched_on", detail: undefined, ok: true });
  });

  it("will not switch a guard on without the tick-box, so a stray Enter in the note field cannot make a feature live", async () => {
    await run(switchGuardAction(form({ viewer: "admin", key: "payouts_enabled", on: "1", note: "ready" })));
    expect(rpc).not.toHaveBeenCalled();
    expect(flash).toHaveBeenCalledWith(expect.objectContaining({ notice: "golive.error.input", ok: false }));
  });

  it("does not claim a recorded switch when the guard was already in that state", async () => {
    rpc.mockResolvedValue({ data: { ok: true, changed: false }, error: null });
    await run(switchGuardAction(form({ viewer: "admin", key: "payouts_enabled", on: "1", confirm: "on", note: "again" })));
    expect(flash).toHaveBeenCalledWith({ notice: "golive.done.unchanged", detail: undefined, ok: true });
  });

  it("never shows a bare permission error, only a message the database wrote for a person", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied for table go_live_guards" } });
    await run(switchGuardAction(form({ viewer: "admin", key: "payouts_enabled", on: "0" })));
    expect(flash).toHaveBeenCalledWith({ notice: "golive.error.generic", detail: undefined, ok: false });
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "only an admin can switch on Payouts" } });
    await run(switchGuardAction(form({ viewer: "admin", key: "payouts_enabled", on: "0" })));
    expect(flash).toHaveBeenLastCalledWith({ notice: "golive.error.generic", detail: "only an admin can switch on Payouts", ok: false });
  });

  it("treats anything other than on=1 as switching off", async () => {
    await run(switchGuardAction(form({ viewer: "admin", key: "payouts_enabled", on: "0" })));
    expect(rpc).toHaveBeenCalledWith("set_go_live_guard", { p_key: "payouts_enabled", p_on: false, p_note: null });
  });

  it("shows what the database says is missing (22023) and never reports success", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "cannot switch on Payouts: not yet met: A fee schedule is approved" } });
    await run(switchGuardAction(form({ viewer: "admin", key: "payouts_enabled", on: "1", confirm: "on", note: "go" })));
    expect(flash).toHaveBeenCalledWith({ notice: "golive.error.generic", detail: "cannot switch on Payouts: not yet met: A fee schedule is approved", ok: false });
  });

  it("hides an unexpected database error behind a generic notice", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "relation secret.table exploded" } });
    await run(switchGuardAction(form({ viewer: "admin", key: "payouts_enabled", on: "1", confirm: "on", note: "go" })));
    expect(flash).toHaveBeenCalledWith({ notice: "golive.error.generic", detail: undefined, ok: false });
  });

  it("lets the CMO through at the CMO door, and returns to the CMO page", async () => {
    role = "clinician";
    cmo = true;
    const msg = await run(switchGuardAction(form({ viewer: "cmo", key: "prescribing_enabled", on: "1", confirm: "on", note: "signed off" })));
    expect(msg).toBe("REDIRECT:/clinician/go-live?n=n-1");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("attestConditionAction", () => {
  it("needs a sentence and a real guard", async () => {
    await run(attestConditionAction(form({ viewer: "admin", key: "payouts_enabled", code: "fee_schedule_approved", met: "1", note: "ok" })));
    expect(flash).toHaveBeenCalledWith(expect.objectContaining({ notice: "golive.error.input" }));
    expect(rpc).not.toHaveBeenCalled();
    await run(attestConditionAction(form({ viewer: "admin", key: "payouts_enabled", code: "fee_schedule_approved", met: "1", note: "Fee schedule v1 approved." })));
    expect(rpc).toHaveBeenCalledWith("attest_go_live_condition", { p_key: "payouts_enabled", p_code: "fee_schedule_approved", p_met: true, p_note: "Fee schedule v1 approved." });
  });
});

describe("signoffConfigAction", () => {
  const inForce = (owner: "CMO" | "Founder") => PROPOSED_CONFIG.find((e) => e.owner === owner && getProposedConfig(e.key).version === e.version)!;

  it("names the signed-in person as the signer, calls the database as the service role, and takes owner and hash from the registry", async () => {
    role = "clinician";
    cmo = true;
    const entry = inForce("CMO");
    await run(signoffConfigAction(form({ viewer: "cmo", key: entry.key, version: String(entry.version), decision: "confirmed", owner: "Founder", value_hash: "f".repeat(64) })));
    expect(rpc).not.toHaveBeenCalled(); // never as the signed-in browser session
    expect(serviceRpc).toHaveBeenCalledWith("record_proposed_config_signoff", {
      p_signer: "signer-1",
      p_key: entry.key,
      p_version: entry.version,
      p_value_hash: hashConfigValue(entry.value),
      p_owner: "CMO",
      p_decision: "confirmed",
      p_note: null,
    });
  });

  it("refuses to confirm a value the viewer does not own, before the database is called", async () => {
    const cmoOwned = inForce("CMO");
    await run(signoffConfigAction(form({ viewer: "admin", key: cmoOwned.key, version: String(cmoOwned.version), decision: "confirmed" })));
    expect(flash).toHaveBeenCalledWith(expect.objectContaining({ notice: "golive.error.input" }));
    expect(serviceRpc).not.toHaveBeenCalled();
  });

  it("refuses a key or version that is not in the registry, or not the version in force", async () => {
    const founder = inForce("Founder");
    await run(signoffConfigAction(form({ viewer: "admin", key: "no.such_key", version: "1", decision: "confirmed" })));
    await run(signoffConfigAction(form({ viewer: "admin", key: founder.key, version: "99", decision: "confirmed" })));
    expect(serviceRpc).not.toHaveBeenCalled();
    expect(flash).toHaveBeenCalledTimes(2);
  });

  it("refuses a version that is no longer in force when the registry has a newer one", async () => {
    const older = PROPOSED_CONFIG.find((e) => PROPOSED_CONFIG.some((o) => o.key === e.key && o.version > e.version));
    if (!older) return; // no key has two versions today
    role = older.owner === "CMO" ? "clinician" : "admin";
    cmo = older.owner === "CMO";
    await run(signoffConfigAction(form({ viewer: older.owner === "CMO" ? "cmo" : "admin", key: older.key, version: String(older.version), decision: "confirmed" })));
    expect(serviceRpc).not.toHaveBeenCalled();
  });

  it("sends a signed-out session back to the front page without calling the database", async () => {
    signedIn = false;
    const entry = inForce("Founder");
    expect(await run(signoffConfigAction(form({ viewer: "admin", key: entry.key, version: String(entry.version), decision: "confirmed" })))).toBe("REDIRECT:/");
    expect(serviceRpc).not.toHaveBeenCalled();
  });
});
