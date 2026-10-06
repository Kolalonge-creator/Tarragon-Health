import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { PROPOSED_CONFIG } from "@tarragon/shared";
import { hashConfigValue } from "./model";

const rpc = jest.fn<(fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>>();
let role: string | null = "admin";
let cmo = false;

jest.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
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
  rpc.mockResolvedValue({ data: { ok: true }, error: null });
  role = "admin";
  cmo = false;
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
    expect(msg).toContain("golive.error.input");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls the one switching function and reports success", async () => {
    const msg = await run(switchGuardAction(form({ viewer: "admin", key: "payouts_enabled", on: "1", note: "ready" })));
    expect(rpc).toHaveBeenCalledWith("set_go_live_guard", { p_key: "payouts_enabled", p_on: true, p_note: "ready" });
    expect(msg).toContain("/admin/go-live");
    expect(msg).toContain("golive.done.switched_on");
    expect(msg).toContain("ok=1");
  });

  it("treats anything other than on=1 as switching off", async () => {
    await run(switchGuardAction(form({ viewer: "admin", key: "payouts_enabled", on: "0" })));
    expect(rpc).toHaveBeenCalledWith("set_go_live_guard", { p_key: "payouts_enabled", p_on: false, p_note: null });
  });

  it("shows what the database says is missing (22023) and never reports success", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "cannot switch on Payouts: not yet met: A fee schedule is approved" } });
    const msg = await run(switchGuardAction(form({ viewer: "admin", key: "payouts_enabled", on: "1", note: "go" })));
    expect(msg).toContain("ok=0");
    expect(decodeURIComponent(msg.replace(/\+/g, " "))).toContain("not yet met: A fee schedule is approved");
  });

  it("hides an unexpected database error behind a generic notice", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "relation secret.table exploded" } });
    const msg = await run(switchGuardAction(form({ viewer: "admin", key: "payouts_enabled", on: "1", note: "go" })));
    expect(msg).toContain("golive.error.generic");
    expect(msg).not.toContain("secret");
  });

  it("lets the CMO through at the CMO door, and returns to the CMO page", async () => {
    role = "clinician";
    cmo = true;
    const msg = await run(switchGuardAction(form({ viewer: "cmo", key: "prescribing_enabled", on: "1", note: "signed off" })));
    expect(msg).toContain("/clinician/go-live");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("attestConditionAction", () => {
  it("needs a sentence and a real guard", async () => {
    expect(await run(attestConditionAction(form({ viewer: "admin", key: "payouts_enabled", code: "fee_schedule_approved", met: "1", note: "ok" })))).toContain("golive.error.input");
    expect(rpc).not.toHaveBeenCalled();
    await run(attestConditionAction(form({ viewer: "admin", key: "payouts_enabled", code: "fee_schedule_approved", met: "1", note: "Fee schedule v1 approved." })));
    expect(rpc).toHaveBeenCalledWith("attest_go_live_condition", { p_key: "payouts_enabled", p_code: "fee_schedule_approved", p_met: true, p_note: "Fee schedule v1 approved." });
  });
});

describe("signoffConfigAction", () => {
  it("takes the owner and the value hash from the registry, never from the form", async () => {
    role = "clinician";
    cmo = true;
    const entry = PROPOSED_CONFIG.find((e) => e.owner === "CMO")!;
    await run(
      signoffConfigAction(form({ viewer: "cmo", key: entry.key, version: String(entry.version), decision: "confirmed", owner: "Founder", value_hash: "f".repeat(64) })),
    );
    expect(rpc).toHaveBeenCalledWith("record_proposed_config_signoff", {
      p_key: entry.key,
      p_version: entry.version,
      p_value_hash: hashConfigValue(entry.value),
      p_owner: "CMO",
      p_decision: "confirmed",
      p_note: null,
    });
  });

  it("refuses to confirm a value the viewer does not own, before the database is called", async () => {
    const cmoOwned = PROPOSED_CONFIG.find((e) => e.owner === "CMO")!;
    const msg = await run(signoffConfigAction(form({ viewer: "admin", key: cmoOwned.key, version: String(cmoOwned.version), decision: "confirmed" })));
    expect(msg).toContain("golive.error.input");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a key or version that is not in the registry", async () => {
    expect(await run(signoffConfigAction(form({ viewer: "admin", key: "no.such_key", version: "1", decision: "confirmed" })))).toContain("golive.error.input");
    const founder = PROPOSED_CONFIG.find((e) => e.owner === "Founder")!;
    expect(await run(signoffConfigAction(form({ viewer: "admin", key: founder.key, version: "99", decision: "confirmed" })))).toContain("golive.error.input");
    expect(rpc).not.toHaveBeenCalled();
  });
});
