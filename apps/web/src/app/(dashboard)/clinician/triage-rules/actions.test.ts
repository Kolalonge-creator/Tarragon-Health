import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const rpc = jest.fn<(fn: string, args: Record<string, unknown>) => Promise<{ error: null }>>();
jest.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(to);
  },
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentClinicalStaff: async () => ({ doctor_tier: "chief_medical_officer" }) }));
jest.mock("@/lib/clinical/doctor-tier", () => ({ canAssignCases: () => true }));

import { approveRuleSetAction } from "./actions";

const id = "11111111-1111-4111-8111-111111111111";
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
async function outcome(fd: FormData): Promise<string> {
  try {
    await approveRuleSetAction(fd);
    return "returned";
  } catch (e) {
    return decodeURIComponent((e as Error).message);
  }
}

describe("approveRuleSetAction signing gate", () => {
  beforeEach(() => rpc.mockReset().mockResolvedValue({ error: null }));

  it("signs when the box is ticked and SIGN is typed, whatever the case or spacing", async () => {
    expect(await outcome(form({ id, understood: "on", typed: " sign " }))).toContain("done=Signed");
    expect(rpc).toHaveBeenCalledWith("approve_triage_rule_set", { p_id: id, p_note: null });
  });

  it("accepts any value a tick box submits, not only the word on", async () => {
    expect(await outcome(form({ id, understood: "true", typed: "SIGN" }))).toContain("done=Signed");
  });

  it("says the box was missing, and signs nothing", async () => {
    expect(await outcome(form({ id, typed: "SIGN" }))).toContain("tick box was not received");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("says what was typed when it is not SIGN, and signs nothing", async () => {
    expect(await outcome(form({ id, understood: "on", typed: "signed" }))).toContain('The word typed was "signed"');
    expect(rpc).not.toHaveBeenCalled();
  });
});
