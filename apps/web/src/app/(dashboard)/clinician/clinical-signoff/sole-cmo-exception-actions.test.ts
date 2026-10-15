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

import { signSoleCmoExceptionAction } from "./sole-cmo-exception-actions";

const REASON = "Only one chief medical officer exists, so the on-call rota needs the CMO on it.";
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const run = async (f: FormData) => { try { await signSoleCmoExceptionAction(f); return "no redirect"; } catch (e) { return (e as Error).message; } };

beforeEach(() => { rpc.mockReset(); flashes.length = 0; staff = { doctor_tier: "chief_medical_officer" }; rpc.mockResolvedValue({ error: null }); });

describe("signSoleCmoExceptionAction", () => {
  it("signs on_call only, with the written reason, as the CMO, and returns to the hub", async () => {
    expect(await run(form({ understood: "on", typed: " sign ", reason: `  ${REASON}  ` }))).toBe("REDIRECT /clinician/clinical-signoff?n=n1");
    expect(rpc).toHaveBeenCalledWith("sign_sole_cmo_exception", { p_competency: "on_call", p_reason: REASON, p_confirm: "SIGN" });
    expect(flashes[0]).toMatchObject({ ok: true });
  });
  it("does nothing without the tick, the typed word, or a long enough reason", async () => {
    await run(form({ typed: "SIGN", reason: REASON }));
    await run(form({ understood: "on", typed: "SING", reason: REASON }));
    await run(form({ understood: "on", typed: "SIGN", reason: "too short" }));
    expect(rpc).not.toHaveBeenCalled();
    expect(flashes.map((f) => f.ok)).toEqual([false, false, false]);
    expect(flashes[2]?.detail).toMatch(/at least 40 characters/);
  });
  it("does nothing for anyone but the CMO", async () => {
    staff = { doctor_tier: "senior_medical_officer" };
    await run(form({ understood: "on", typed: "SIGN", reason: REASON }));
    expect(rpc).not.toHaveBeenCalled();
    expect(flashes[0]?.detail).toMatch(/Chief Medical Officer/);
  });
  it("shows a person-readable database refusal as written and hides anything else", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "a second chief medical officer exists, so the normal grant applies", code: "23514" } });
    await run(form({ understood: "on", typed: "SIGN", reason: REASON }));
    expect(flashes[0]?.detail).toBe("a second chief medical officer exists, so the normal grant applies");
    rpc.mockResolvedValueOnce({ error: { message: "relation x does not exist", code: "42P01" } });
    await run(form({ understood: "on", typed: "SIGN", reason: REASON }));
    expect(flashes[1]?.detail).toMatch(/^Something went wrong/);
  });
});
