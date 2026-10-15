import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const rpc = jest.fn<(name: string) => Promise<{ data: unknown; error: { code?: string } | null }>>();
let role: string | null = "admin";
let tier: string | null = null;

jest.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/auth/current-profile", () => ({
  getCurrentProfile: async () => (role ? { role } : null),
  getCurrentClinicalStaff: async () => (tier ? { doctor_tier: tier } : null),
}));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { runCanaryNowAction } from "./actions";

async function run(from?: string): Promise<string> {
  const f = new FormData();
  if (from) f.set("from", from);
  try {
    await runCanaryNowAction(f);
  } catch (e) {
    return (e as Error).message;
  }
  return "no redirect";
}

describe("runCanaryNowAction", () => {
  beforeEach(() => {
    rpc.mockReset();
    role = "admin";
    tier = null;
  });

  it("starts a run for an admin", async () => {
    rpc.mockResolvedValue({ data: "id", error: null });
    expect(await run()).toBe("REDIRECT:/admin/ops/chain-health?r=started");
    expect(rpc).toHaveBeenCalledWith("chain_canary_run_now");
  });

  it("starts a run for the chief medical officer and returns to the clinician page", async () => {
    role = "clinician";
    tier = "chief_medical_officer";
    rpc.mockResolvedValue({ data: "id", error: null });
    expect(await run("clinician")).toBe("REDIRECT:/clinician/chain-health?r=started");
  });

  it("never calls the database for anyone else", async () => {
    role = "clinician";
    tier = "senior_medical_officer";
    expect(await run("clinician")).toBe("REDIRECT:/clinician/chain-health?r=failed");
    role = null;
    expect(await run()).toBe("REDIRECT:/admin/ops/chain-health?r=failed");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("says wait when a run is still waiting to be judged and failed when the call errors", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023" } });
    expect(await run()).toBe("REDIRECT:/admin/ops/chain-health?r=wait");
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    expect(await run()).toBe("REDIRECT:/admin/ops/chain-health?r=failed");
  });
});
