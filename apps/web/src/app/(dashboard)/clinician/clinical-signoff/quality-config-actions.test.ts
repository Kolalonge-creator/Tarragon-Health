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

import { signCredentialingConfigAction, signQualityConfigAction } from "./quality-config-actions";
import { newestWaiting } from "@/lib/queries/pending-quality-config-signoff";

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const run = async (fn: (f: FormData) => Promise<void>, f: FormData) => { try { await fn(f); return "no redirect"; } catch (e) { return (e as Error).message; } };

beforeEach(() => { rpc.mockReset(); flashes.length = 0; staff = { doctor_tier: "chief_medical_officer" }; rpc.mockResolvedValue({ error: null }); });

describe("signing the S20 v2 configurations", () => {
  it("signs exactly the version named, as the CMO, with the tick", async () => {
    expect(await run(signQualityConfigAction, form({ understood: "on", version: "3" }))).toBe("REDIRECT /clinician/clinical-signoff?n=n1");
    expect(rpc).toHaveBeenCalledWith("sign_quality_config", { p_version: 3 });
    expect(await run(signCredentialingConfigAction, form({ understood: "on", version: "4" }))).toBe("REDIRECT /clinician/clinical-signoff?n=n1");
    expect(rpc).toHaveBeenLastCalledWith("sign_credentialing_config", { p_version: 4 });
    expect(flashes.every((f) => f.ok)).toBe(true);
  });
  it("signs nothing without the tick or with a bad version", async () => {
    await run(signQualityConfigAction, form({ version: "3" }));
    await run(signQualityConfigAction, form({ understood: "on", version: "abc" }));
    expect(rpc).not.toHaveBeenCalled();
    expect(flashes.every((f) => !f.ok)).toBe(true);
  });
  it("signs nothing for anyone but the CMO", async () => {
    staff = { doctor_tier: "senior_medical_officer" };
    await run(signCredentialingConfigAction, form({ understood: "on", version: "4" }));
    expect(rpc).not.toHaveBeenCalled();
    expect(flashes[0]?.detail).toMatch(/Chief Medical Officer/);
  });
  it("shows the database's own sentence for a refusal (a missing licence date) and hides anything else", async () => {
    rpc.mockResolvedValue({ error: { message: "record the licence expiry date of 2 active clinician(s) first", code: "23514" } });
    await run(signCredentialingConfigAction, form({ understood: "on", version: "4" }));
    expect(flashes[0]?.detail).toMatch(/licence expiry date/);
    rpc.mockResolvedValue({ error: { message: "connection reset", code: "08006" } });
    await run(signQualityConfigAction, form({ understood: "on", version: "3" }));
    expect(flashes[1]?.detail).not.toMatch(/connection/);
  });
});

describe("newestWaiting", () => {
  it("is the newest unsigned inactive version newer than the one in force", () => {
    expect(newestWaiting([{ version: 2, is_active: true, approved_at: null }, { version: 3, is_active: false, approved_at: null }])).toBe(3);
    expect(newestWaiting([{ version: 2, is_active: false, approved_at: "x" }, { version: 3, is_active: true, approved_at: "x" }])).toBeNull();
    expect(newestWaiting([{ version: 3, is_active: true, approved_at: null }, { version: 2, is_active: false, approved_at: null }])).toBeNull();
    expect(newestWaiting([])).toBeNull();
  });
});
