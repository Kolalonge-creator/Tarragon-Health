import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const redirect = jest.fn<(url: string) => never>((url: string) => {
  throw new Error(`REDIRECT ${url}`);
});
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
const rpc = jest.fn<(fn: string, args?: Record<string, unknown>) => Promise<{ error: { message: string; code?: string } | null }>>();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: (fn: string, args?: Record<string, unknown>) => rpc(fn, args) }) }));
let staff: { doctor_tier: string } | null = { doctor_tier: "chief_medical_officer" };
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentClinicalStaff: async () => staff }));
jest.mock("@/lib/clinical/doctor-tier", () => ({ canAssignCases: (s: { doctor_tier: string } | null) => s?.doctor_tier === "chief_medical_officer" }));
const flashes: Array<{ notice: string; detail?: string; ok: boolean }> = [];
jest.mock("@/lib/go-live/flash", () => ({ setFlash: async (f: { notice: string; detail?: string; ok: boolean }) => { flashes.push(f); return "n1"; } }));

import { switchOffUnifiedRedPagingAction, switchOnUnifiedRedPagingAction } from "./unified-red-paging-actions";
import { unifiedRedPagingState } from "@/lib/queries/pending-unified-red-paging-signoff";

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const run = async (fn: (f: FormData) => Promise<void>, f: FormData) => { try { await fn(f); return "no redirect"; } catch (e) { return (e as Error).message; } };
const runOff = async () => { try { await switchOffUnifiedRedPagingAction(); return "no redirect"; } catch (e) { return (e as Error).message; } };

beforeEach(() => { rpc.mockReset(); flashes.length = 0; staff = { doctor_tier: "chief_medical_officer" }; rpc.mockResolvedValue({ error: null }); });

describe("switching unified red-event paging on", () => {
  it("switches on exactly the version named, as the CMO, with both ticks", async () => {
    expect(await run(switchOnUnifiedRedPagingAction, form({ understood: "on", test_pack_run: "on", version: "1" }))).toBe("REDIRECT /clinician/clinical-signoff?n=n1");
    expect(rpc).toHaveBeenCalledWith("sign_unified_red_paging_config", { p_version: 1, p_test_pack_run: true });
    expect(flashes.every((f) => f.ok)).toBe(true);
  });
  it("switches nothing on without both ticks or with a bad version", async () => {
    await run(switchOnUnifiedRedPagingAction, form({ test_pack_run: "on", version: "1" }));
    await run(switchOnUnifiedRedPagingAction, form({ understood: "on", version: "1" }));
    await run(switchOnUnifiedRedPagingAction, form({ understood: "on", test_pack_run: "on", version: "abc" }));
    expect(rpc).not.toHaveBeenCalled();
    expect(flashes.every((f) => !f.ok)).toBe(true);
  });
  it("switches nothing on for anyone but the CMO", async () => {
    staff = { doctor_tier: "senior_medical_officer" };
    await run(switchOnUnifiedRedPagingAction, form({ understood: "on", test_pack_run: "on", version: "1" }));
    expect(rpc).not.toHaveBeenCalled();
    expect(flashes[0]?.detail).toMatch(/Chief Medical Officer/);
    staff = null;
    await run(switchOnUnifiedRedPagingAction, form({ understood: "on", test_pack_run: "on", version: "1" }));
    expect(rpc).not.toHaveBeenCalled();
  });
  it("shows the database's own sentence for a refusal and hides anything else", async () => {
    rpc.mockResolvedValue({ error: { message: "only the chief medical officer can switch unified red-event paging on", code: "42501" } });
    await run(switchOnUnifiedRedPagingAction, form({ understood: "on", test_pack_run: "on", version: "1" }));
    expect(flashes[0]?.detail).toMatch(/chief medical officer/);
    rpc.mockResolvedValue({ error: { message: "connection reset", code: "08006" } });
    await run(switchOnUnifiedRedPagingAction, form({ understood: "on", test_pack_run: "on", version: "1" }));
    expect(flashes[1]?.detail).not.toMatch(/connection/);
  });
});

describe("switching it off", () => {
  it("calls the switch-off for the CMO and for nobody else", async () => {
    expect(await runOff()).toBe("REDIRECT /clinician/clinical-signoff?n=n1");
    expect(rpc).toHaveBeenCalledWith("switch_off_unified_red_paging", undefined);
    rpc.mockClear();
    staff = { doctor_tier: "senior_medical_officer" };
    await runOff();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("unifiedRedPagingState", () => {
  it("reads OFF when no version is live and ON when one is", () => {
    expect(unifiedRedPagingState([{ version: 1, is_active: false, approved_at: null }])).toEqual({ waitingVersion: 1, liveVersion: null });
    expect(unifiedRedPagingState([{ version: 1, is_active: true, approved_at: "x" }])).toEqual({ waitingVersion: null, liveVersion: 1 });
    // an older version never waits behind a newer live one; a newer unsigned one can replace the live one in a single step
    expect(unifiedRedPagingState([{ version: 1, is_active: false, approved_at: "x" }, { version: 2, is_active: true, approved_at: "x" }])).toEqual({ waitingVersion: null, liveVersion: 2 });
    expect(unifiedRedPagingState([{ version: 1, is_active: true, approved_at: "x" }, { version: 2, is_active: false, approved_at: null }])).toEqual({ waitingVersion: 2, liveVersion: 1 });
    expect(unifiedRedPagingState([])).toEqual({ waitingVersion: null, liveVersion: null });
  });
});
