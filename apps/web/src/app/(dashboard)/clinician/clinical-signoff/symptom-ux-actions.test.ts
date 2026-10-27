import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const redirect = jest.fn<(url: string) => never>((url: string) => {
  throw new Error(`REDIRECT ${url}`);
});
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
const rpc = jest.fn<(fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string; code?: string } | null }>>();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: (fn: string, args: Record<string, unknown>) => rpc(fn, args) }) }));
let staff: { doctor_tier: string } | null = { doctor_tier: "chief_medical_officer" };
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentClinicalStaff: async () => staff }));
jest.mock("@/lib/clinical/doctor-tier", () => ({ canAssignCases: (s: { doctor_tier: string } | null) => s?.doctor_tier === "chief_medical_officer" }));
const flashes: Array<{ notice: string; detail?: string; ok: boolean }> = [];
jest.mock("@/lib/go-live/flash", () => ({ setFlash: async (f: { notice: string; detail?: string; ok: boolean }) => { flashes.push(f); return "n1"; } }));

import { signSymptomUxConfigAction } from "./symptom-ux-actions";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const run = async (f: FormData) => {
  try {
    await signSymptomUxConfigAction(f);
    return "no redirect";
  } catch (e) {
    return (e as Error).message;
  }
};

beforeEach(() => {
  rpc.mockReset();
  flashes.length = 0;
  staff = { doctor_tier: "chief_medical_officer" };
  rpc.mockResolvedValue({ error: null });
});

describe("signSymptomUxConfigAction (S59c)", () => {
  it("signs the named kind and version as the CMO, and returns to the hub", async () => {
    expect(await run(form({ understood: "on", kind: "safety_net", version: "1" }))).toBe("REDIRECT /clinician/clinical-signoff?n=n1");
    expect(rpc).toHaveBeenCalledWith("sign_symptom_ux_config", { p_kind: "safety_net", p_version: 1 });
    expect(flashes[0]).toMatchObject({ ok: true });
  });
  it("does nothing without the tick or with an unknown kind or version", async () => {
    await run(form({ kind: "checkback", version: "1" }));
    await run(form({ understood: "on", kind: "everything", version: "1" }));
    await run(form({ understood: "on", kind: "checkback", version: "0" }));
    expect(rpc).not.toHaveBeenCalled();
    expect(flashes.map((f) => f.ok)).toEqual([false, false, false]);
  });
  it("does nothing for anyone but the CMO", async () => {
    staff = { doctor_tier: "senior_medical_officer" };
    await run(form({ understood: "on", kind: "describe", version: "1" }));
    expect(rpc).not.toHaveBeenCalled();
    expect(flashes[0]?.detail).toMatch(/Chief Medical Officer/);
  });
  it("shows a person-readable database refusal as written and hides anything else", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "that version is already signed", code: "23514" } });
    await run(form({ understood: "on", kind: "explainer", version: "1" }));
    expect(flashes[0]?.detail).toBe("that version is already signed");
    rpc.mockResolvedValueOnce({ error: { message: "relation x does not exist", code: "42P01" } });
    await run(form({ understood: "on", kind: "explainer", version: "1" }));
    expect(flashes[1]?.detail).toMatch(/^Something went wrong/);
  });
});
