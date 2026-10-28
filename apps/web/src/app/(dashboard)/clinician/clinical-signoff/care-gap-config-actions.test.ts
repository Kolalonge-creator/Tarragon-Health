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

import { signCareGapConfigAction } from "./care-gap-config-actions";

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const run = async (f: FormData) => { try { await signCareGapConfigAction(f); return "no redirect"; } catch (e) { return (e as Error).message; } };

beforeEach(() => { rpc.mockReset(); flashes.length = 0; staff = { doctor_tier: "chief_medical_officer" }; rpc.mockResolvedValue({ error: null }); });

describe("signing the care gap rules (S90)", () => {
  it("signs exactly the version named, as the CMO, with the tick, and calls only the signing function", async () => {
    expect(await run(form({ understood: "on", version: "1" }))).toBe("REDIRECT /clinician/clinical-signoff?n=n1");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("sign_care_gap_rule_config", { p_version: 1 });
    expect(flashes.every((f) => f.ok)).toBe(true);
  });
  it("never switches the engine on: no go-live guard function is called", async () => {
    await run(form({ understood: "on", version: "1" }));
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["sign_care_gap_rule_config"]);
  });
  it("signs nothing without the tick or with a bad version", async () => {
    await run(form({ version: "1" }));
    await run(form({ understood: "on", version: "abc" }));
    await run(form({ understood: "on", version: "0" }));
    expect(rpc).not.toHaveBeenCalled();
    expect(flashes.every((f) => !f.ok)).toBe(true);
  });
  it("signs nothing for anyone but the CMO", async () => {
    staff = { doctor_tier: "senior_medical_officer" };
    await run(form({ understood: "on", version: "1" }));
    expect(rpc).not.toHaveBeenCalled();
    expect(flashes[0]?.detail).toMatch(/Chief Medical Officer/);
    staff = null;
    await run(form({ understood: "on", version: "1" }));
    expect(rpc).not.toHaveBeenCalled();
  });
  it("shows the database's own sentence for a refusal and hides anything else", async () => {
    rpc.mockResolvedValue({ error: { message: "that version is already signed", code: "23514" } });
    await run(form({ understood: "on", version: "1" }));
    expect(flashes[0]?.detail).toMatch(/already signed/);
    rpc.mockResolvedValue({ error: { message: "connection reset", code: "08006" } });
    await run(form({ understood: "on", version: "1" }));
    expect(flashes[1]?.detail).not.toMatch(/connection/);
    expect(flashes[1]?.ok).toBe(false);
  });
});
