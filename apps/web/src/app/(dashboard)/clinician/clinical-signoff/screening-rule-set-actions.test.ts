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

type Pending = { draftId: string | null; signable: boolean; failed: boolean };
let pending: Pending = { draftId: "11111111-1111-4111-8111-111111111111", signable: true, failed: false };
jest.mock("@/lib/queries/pending-screening-rule-set-signoff", () => ({ readPendingScreeningRuleSet: async () => pending }));

import { signScreeningRuleSetAction } from "./screening-rule-set-actions";

const ID = "11111111-1111-4111-8111-111111111111";
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const run = async (f: FormData) => { try { await signScreeningRuleSetAction(f); return "no redirect"; } catch (e) { return (e as Error).message; } };

beforeEach(() => { rpc.mockReset(); flashes.length = 0; staff = { doctor_tier: "chief_medical_officer" }; pending = { draftId: ID, signable: true, failed: false }; rpc.mockResolvedValue({ error: null }); });

describe("signScreeningRuleSetAction", () => {
  it("signs the draft the hub is showing, as the CMO, and returns to the hub", async () => {
    expect(await run(form({ understood: "on", typed: " sign ", id: ID }))).toBe("REDIRECT /clinician/clinical-signoff?n=n1");
    expect(rpc).toHaveBeenCalledWith("sign_screening_rule_set", { p_id: ID });
    expect(flashes[0]).toMatchObject({ ok: true });
  });
  it("does nothing without the tick, the typed word, or a real id", async () => {
    await run(form({ typed: "SIGN", id: ID }));
    await run(form({ understood: "on", typed: "SING", id: ID }));
    await run(form({ understood: "on", typed: "SIGN", id: "not-a-uuid" }));
    expect(rpc).not.toHaveBeenCalled();
    expect(flashes.map((f) => f.ok)).toEqual([false, false, false]);
  });
  it("does nothing for anyone but the CMO", async () => {
    staff = { doctor_tier: "senior_medical_officer" };
    await run(form({ understood: "on", typed: "SIGN", id: ID }));
    expect(rpc).not.toHaveBeenCalled();
    expect(flashes[0]?.detail).toMatch(/Chief Medical Officer/);
  });
  it("refuses an id that is not the draft waiting now, a draft that cannot be signed here, and an unreadable draft", async () => {
    await run(form({ understood: "on", typed: "SIGN", id: "22222222-2222-4222-8222-222222222222" }));
    pending = { draftId: ID, signable: false, failed: false };
    await run(form({ understood: "on", typed: "SIGN", id: ID }));
    pending = { draftId: null, signable: false, failed: true };
    await run(form({ understood: "on", typed: "SIGN", id: ID }));
    expect(rpc).not.toHaveBeenCalled();
    expect(flashes.map((f) => f.ok)).toEqual([false, false, false]);
    expect(flashes[0]?.detail).toMatch(/no longer the one waiting/);
    expect(flashes[1]?.detail).toMatch(/changes the rules themselves/);
  });
  it("shows a person-readable database refusal as written and hides anything else", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "not authorised: only the active Chief Medical Officer can sign the screening rules", code: "42501" } });
    await run(form({ understood: "on", typed: "SIGN", id: ID }));
    expect(flashes[0]?.detail).toMatch(/only the active Chief Medical Officer/);
    rpc.mockResolvedValueOnce({ error: { message: "relation x does not exist", code: "42P01" } });
    await run(form({ understood: "on", typed: "SIGN", id: ID }));
    expect(flashes[1]?.detail).toMatch(/^Something went wrong/);
  });
});
