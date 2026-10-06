import { describe, expect, it, jest, beforeEach } from "@jest/globals";

jest.mock("next/navigation", () => ({
  redirect: jest.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() =>
    Promise.resolve({ rpc: jest.fn(() => Promise.resolve({ data: null, error: null })) }),
  ),
}));
jest.mock("@/lib/auth/current-profile", () => ({
  getCurrentClinicalStaff: jest.fn(() => ({ doctor_tier: "chief_medical_officer" })),
}));
jest.mock("@/lib/clinical/doctor-tier", () => ({
  canAssignCases: jest.fn(() => true),
}));

import { approveRuleSetAction } from "./actions";

function makeForm(fields: Record<string, string | null>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null) fd.append(k, v);
  }
  return fd;
}

async function run(fields: Record<string, string | null>): Promise<string> {
  try {
    await approveRuleSetAction(makeForm(fields));
    return "NO_REDIRECT";
  } catch (e: unknown) {
    const msg = (e as Error).message;
    if (msg.startsWith("REDIRECT:")) return msg.slice("REDIRECT:".length);
    throw e;
  }
}

describe("approveRuleSetAction", () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it("signs when the box is ticked and the word is SIGN", async () => {
    const url = await run({ id: "5b2f3c52-6f29-4d1a-8f3e-1a2b3c4d5e6f", understood: "on", typed: "SIGN" });
    expect(url).toContain("done=");
  });

  it("accepts any truthy tick value, not just 'on'", async () => {
    const url = await run({ id: "5b2f3c52-6f29-4d1a-8f3e-1a2b3c4d5e6f", understood: "yes", typed: "sign" });
    expect(url).toContain("done=");
  });

  it("rejects a missing tick", async () => {
    const url = await run({ id: "5b2f3c52-6f29-4d1a-8f3e-1a2b3c4d5e6f", understood: null, typed: "SIGN" });
    expect(url).toContain("error=");
    expect(decodeURIComponent(url)).toContain("Tick the checkbox");
  });

  it("rejects the wrong word", async () => {
    const url = await run({ id: "5b2f3c52-6f29-4d1a-8f3e-1a2b3c4d5e6f", understood: "on", typed: "APPROVE" });
    expect(url).toContain("error=");
    expect(decodeURIComponent(url)).toContain("Type the word SIGN");
  });
});
