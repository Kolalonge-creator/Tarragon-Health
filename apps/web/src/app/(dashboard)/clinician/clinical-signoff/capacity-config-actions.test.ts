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

import { signCapacityConfigAction, signLeadConfigAction } from "./capacity-config-actions";

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const run = async (fn: (f: FormData) => Promise<void>, f: FormData) => { try { await fn(f); return "no redirect"; } catch (e) { return (e as Error).message; } };

beforeEach(() => { rpc.mockReset(); flashes.length = 0; staff = { doctor_tier: "chief_medical_officer" }; rpc.mockResolvedValue({ error: null }); });

describe("signing the capacity and lead configurations", () => {
  it("signs exactly the version named, as the CMO, with the tick", async () => {
    expect(await run(signCapacityConfigAction, form({ understood: "on", version: "2" }))).toBe("REDIRECT /clinician/clinical-signoff?n=n1");
    expect(rpc).toHaveBeenCalledWith("sign_capacity_cover_config", { p_version: 2 });
    expect(await run(signLeadConfigAction, form({ understood: "on", version: "2" }))).toBe("REDIRECT /clinician/clinical-signoff?n=n1");
    expect(rpc).toHaveBeenLastCalledWith("sign_lead_config", { p_version: 2 });
    expect(flashes.every((f) => f.ok)).toBe(true);
  });

  it("signs nothing without the tick or with a bad version", async () => {
    await run(signCapacityConfigAction, form({ version: "2" }));
    await run(signLeadConfigAction, form({ understood: "on", version: "abc" }));
    expect(rpc).not.toHaveBeenCalled();
    expect(flashes.every((f) => !f.ok)).toBe(true);
  });

  it("signs nothing for anyone but the CMO", async () => {
    staff = { doctor_tier: "senior_medical_officer" };
    await run(signCapacityConfigAction, form({ understood: "on", version: "2" }));
    expect(rpc).not.toHaveBeenCalled();
    expect(flashes[0]?.detail).toMatch(/Chief Medical Officer/);
  });

  it("shows the database's own sentence for a refusal and hides anything else", async () => {
    rpc.mockResolvedValue({ error: { message: "that version is already signed", code: "23514" } });
    await run(signLeadConfigAction, form({ understood: "on", version: "2" }));
    expect(flashes[0]?.detail).toMatch(/already signed/);
    rpc.mockResolvedValue({ error: { message: "connection reset", code: "08006" } });
    await run(signCapacityConfigAction, form({ understood: "on", version: "2" }));
    expect(flashes[1]?.detail).not.toMatch(/connection/);
  });
});
