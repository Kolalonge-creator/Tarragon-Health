import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const redirect = jest.fn<(url: string) => never>((url: string) => { throw new Error(`REDIRECT ${url}`); });
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
const rpc = jest.fn<(fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string; code?: string } | null }>>();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: (fn: string, args: Record<string, unknown>) => rpc(fn, args) }) }));
let staff: { doctor_tier: string } | null = { doctor_tier: "chief_medical_officer" };
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentClinicalStaff: async () => staff }));
jest.mock("@/lib/clinical/doctor-tier", () => ({ canAssignCases: (s: { doctor_tier: string } | null) => s?.doctor_tier === "chief_medical_officer" }));
const flashes: Array<{ notice: string; detail?: string; ok: boolean }> = [];
jest.mock("@/lib/go-live/flash", () => ({ setFlash: async (f: { notice: string; detail?: string; ok: boolean }) => { flashes.push(f); return "n1"; } }));

import { reviewThresholdOverrideAction, signThresholdPolicyAction, withdrawThresholdPolicyAction } from "./actions";

const ID = "22222222-2222-4222-8222-222222222222";
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const run = async (fn: (f: FormData) => Promise<void>, f: FormData) => { try { await fn(f); return "no redirect"; } catch (e) { return (e as Error).message; } };

beforeEach(() => { rpc.mockReset(); flashes.length = 0; staff = { doctor_tier: "chief_medical_officer" }; rpc.mockResolvedValue({ error: null }); });

describe("CMO threshold oversight actions", () => {
  it("only the CMO can do any of them", async () => {
    staff = { doctor_tier: "senior_medical_officer" };
    await run(reviewThresholdOverrideAction, form({ override_id: ID, outcome: "continue", note: "still right" }));
    await run(signThresholdPolicyAction, form({ policy_id: ID, understood: "on", typed: "SIGN" }));
    await run(withdrawThresholdPolicyAction, form({ reason: "pause the feature" }));
    expect(rpc).not.toHaveBeenCalled();
    expect(flashes.map((f) => f.detail)).toEqual(Array(3).fill("Only the Chief Medical Officer can do this."));
  });
  it("review: keeps or ends, needs a note and a valid id", async () => {
    expect(await run(reviewThresholdOverrideAction, form({ override_id: ID, outcome: "revoke", note: "No longer needed" }))).toBe("REDIRECT /clinician/threshold-overrides?n=n1");
    expect(rpc).toHaveBeenCalledWith("review_threshold_override", { p_id: ID, p_outcome: "revoke", p_note: "No longer needed" });
    await run(reviewThresholdOverrideAction, form({ override_id: "x", outcome: "continue", note: "still right" }));
    await run(reviewThresholdOverrideAction, form({ override_id: ID, outcome: "maybe", note: "still right" }));
    await run(reviewThresholdOverrideAction, form({ override_id: ID, outcome: "continue", note: "no" }));
    await run(reviewThresholdOverrideAction, form({ override_id: ID, outcome: "continue" }));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(flashes.slice(1).every((f) => !f.ok)).toBe(true);
  });
  it("review: shows a written database refusal and hides anything else", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "only a live override can be reviewed", code: "22023" } });
    await run(reviewThresholdOverrideAction, form({ override_id: ID, outcome: "continue", note: "still right" }));
    expect(flashes[0]?.detail).toBe("only a live override can be reviewed");
    rpc.mockResolvedValueOnce({ error: { message: "relation x", code: "42P01" } });
    await run(reviewThresholdOverrideAction, form({ override_id: ID, outcome: "continue", note: "still right" }));
    expect(flashes[1]?.detail).toMatch(/^Something went wrong/);
  });
  it("policy: signs only with the tick, the typed word and a valid id", async () => {
    expect(await run(signThresholdPolicyAction, form({ policy_id: ID, understood: "on", typed: " sign " }))).toBe("REDIRECT /clinician/threshold-overrides?n=n1");
    expect(rpc).toHaveBeenCalledWith("sign_threshold_override_policy", { p_id: ID, p_confirm: "SIGN" });
    await run(signThresholdPolicyAction, form({ policy_id: ID, typed: "SIGN" }));
    await run(signThresholdPolicyAction, form({ policy_id: ID, understood: "on", typed: "SING" }));
    await run(signThresholdPolicyAction, form({ policy_id: "x", understood: "on", typed: "SIGN" }));
    rpc.mockResolvedValueOnce({ error: { message: "this version is already signed; a change is a new version", code: "22023" } });
    await run(signThresholdPolicyAction, form({ policy_id: ID, understood: "on", typed: "SIGN" }));
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(flashes.filter((f) => !f.ok)).toHaveLength(4);
  });
  it("withdraw: needs a reason and calls the kill switch", async () => {
    expect(await run(withdrawThresholdPolicyAction, form({ reason: "pause the feature" }))).toBe("REDIRECT /clinician/threshold-overrides?n=n1");
    expect(rpc).toHaveBeenCalledWith("withdraw_threshold_override_policy", { p_reason: "pause the feature" });
    await run(withdrawThresholdPolicyAction, form({ reason: "no" }));
    rpc.mockResolvedValueOnce({ error: { message: "boom", code: "XX000" } });
    await run(withdrawThresholdPolicyAction, form({ reason: "pause the feature" }));
    expect(flashes.filter((f) => !f.ok)).toHaveLength(2);
  });
});
