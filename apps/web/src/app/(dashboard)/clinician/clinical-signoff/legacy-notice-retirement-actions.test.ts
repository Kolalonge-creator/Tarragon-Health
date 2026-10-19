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

import { switchOffLegacyNoticeRetirementAction, switchOnLegacyNoticeRetirementAction } from "./legacy-notice-retirement-actions";
import { describeLegacyNoticeRules, parseLegacyNoticeRules } from "@/lib/queries/pending-legacy-notice-retirement-signoff";

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const run = async (fn: (f: FormData) => Promise<void>, f: FormData) => { try { await fn(f); return "no redirect"; } catch (e) { return (e as Error).message; } };
const runOff = async () => { try { await switchOffLegacyNoticeRetirementAction(); return "no redirect"; } catch (e) { return (e as Error).message; } };

beforeEach(() => { rpc.mockReset(); flashes.length = 0; staff = { doctor_tier: "chief_medical_officer" }; rpc.mockResolvedValue({ error: null }); });

describe("switching the legacy notice retirement on", () => {
  it("switches on exactly the version named, as the CMO, with both ticks", async () => {
    expect(await run(switchOnLegacyNoticeRetirementAction, form({ understood: "on", test_pack_run: "on", version: "2" }))).toBe("REDIRECT /clinician/clinical-signoff?n=n1");
    expect(rpc).toHaveBeenCalledWith("sign_legacy_notice_retirement_config", { p_version: 2, p_test_pack_run: true });
    expect(flashes.every((f) => f.ok)).toBe(true);
  });
  it("switches nothing on without both ticks or with a bad version", async () => {
    await run(switchOnLegacyNoticeRetirementAction, form({ test_pack_run: "on", version: "1" }));
    await run(switchOnLegacyNoticeRetirementAction, form({ understood: "on", version: "1" }));
    await run(switchOnLegacyNoticeRetirementAction, form({ understood: "on", test_pack_run: "on", version: "abc" }));
    expect(rpc).not.toHaveBeenCalled();
    expect(flashes.every((f) => !f.ok)).toBe(true);
  });
  it("switches nothing on for anyone but the CMO", async () => {
    staff = { doctor_tier: "senior_medical_officer" };
    await run(switchOnLegacyNoticeRetirementAction, form({ understood: "on", test_pack_run: "on", version: "1" }));
    expect(rpc).not.toHaveBeenCalled();
    expect(flashes[0]?.detail).toMatch(/Chief Medical Officer/);
    staff = null;
    await run(switchOnLegacyNoticeRetirementAction, form({ understood: "on", test_pack_run: "on", version: "1" }));
    expect(rpc).not.toHaveBeenCalled();
  });
  it("shows the database's own sentence for the parallel-run-first refusal and hides anything else", async () => {
    rpc.mockResolvedValue({ error: { message: "run the parallel-run version (nothing retired) first, and look at the measurement, before retiring a broadcast", code: "23514" } });
    await run(switchOnLegacyNoticeRetirementAction, form({ understood: "on", test_pack_run: "on", version: "2" }));
    expect(flashes[0]?.detail).toMatch(/parallel-run version/);
    rpc.mockResolvedValue({ error: { message: "connection reset", code: "08006" } });
    await run(switchOnLegacyNoticeRetirementAction, form({ understood: "on", test_pack_run: "on", version: "2" }));
    expect(flashes[1]?.detail).not.toMatch(/connection/);
  });
});

describe("switching it off", () => {
  it("calls the switch-off for the CMO and for nobody else", async () => {
    expect(await runOff()).toBe("REDIRECT /clinician/clinical-signoff?n=n1");
    expect(rpc).toHaveBeenCalledWith("switch_off_legacy_notice_retirement", undefined);
    rpc.mockClear();
    staff = { doctor_tier: "senior_medical_officer" };
    await runOff();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("version rules", () => {
  const base = { observe: 1, suppress_legacy_bp_notice: 0, suppress_legacy_glucose_notice: 0, suppress_legacy_emergency_notice: 0, circle_notice_unified_page: 0, hold_seconds: 60 };
  it("reads whole numbers only and never guesses a missing value", () => {
    expect(parseLegacyNoticeRules(base)).toEqual(base);
    expect(parseLegacyNoticeRules({ ...base, hold_seconds: "60" })).toBeNull();
    expect(parseLegacyNoticeRules({ observe: 1 })).toBeNull();
  });
  it("describes a version from its own values", () => {
    expect(describeLegacyNoticeRules(base)).toMatch(/Parallel run: nothing changes/);
    const retire = describeLegacyNoticeRules({ ...base, suppress_legacy_bp_notice: 1, suppress_legacy_glucose_notice: 1 });
    expect(retire).toMatch(/blood pressure red events and glucose emergencies/);
    expect(retire).toMatch(/keep their notify-everyone message/);
    expect(describeLegacyNoticeRules({ ...base, suppress_legacy_bp_notice: 1, suppress_legacy_emergency_notice: 1 })).toMatch(/Emergency-level events are included/);
    expect(describeLegacyNoticeRules({ ...base, circle_notice_unified_page: 1 })).toMatch(/Care Circle/);
  });
});
