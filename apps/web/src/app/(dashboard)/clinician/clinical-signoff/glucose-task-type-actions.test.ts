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

import { confirmGlucoseTaskTypeAction } from "./glucose-task-type-actions";

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const run = async (f: FormData) => { try { await confirmGlucoseTaskTypeAction(f); return "no redirect"; } catch (e) { return (e as Error).message; } };

beforeEach(() => { rpc.mockReset(); flashes.length = 0; staff = { doctor_tier: "chief_medical_officer" }; rpc.mockResolvedValue({ error: null }); });

describe("confirmGlucoseTaskTypeAction", () => {
  it("confirms exactly the urgent glucose review task type, as the CMO, and returns to the hub", async () => {
    expect(await run(form({ understood: "on", note: "reviewed" }))).toBe("REDIRECT /clinician/clinical-signoff?n=n1");
    expect(rpc).toHaveBeenCalledWith("confirm_task_type", { p_code: "amber_glucose_review", p_note: "reviewed" });
    expect(flashes[0]).toMatchObject({ ok: true });
  });
  it("does nothing without the tick", async () => {
    await run(form({}));
    expect(rpc).not.toHaveBeenCalled();
    expect(flashes[0]).toMatchObject({ ok: false });
  });
  it("does nothing for anyone but the CMO (the database refuses too)", async () => {
    staff = { doctor_tier: "senior_medical_officer" };
    await run(form({ understood: "on" }));
    expect(rpc).not.toHaveBeenCalled();
    expect(flashes[0]?.detail).toMatch(/Chief Medical Officer/);
  });
  it("shows a person-readable database refusal as written and hides anything else", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "only the Chief Medical Officer can confirm a task type", code: "42501" } });
    await run(form({ understood: "on" }));
    expect(flashes[0]?.detail).toBe("only the Chief Medical Officer can confirm a task type");
    rpc.mockResolvedValueOnce({ error: { message: "relation x does not exist", code: "42P01" } });
    await run(form({ understood: "on" }));
    expect(flashes[1]?.detail).toBe("Something went wrong. Nothing was changed. Please try again.");
  });
});
