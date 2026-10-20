import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const redirect = jest.fn<(url: string) => never>((url: string) => {
  throw new Error(`REDIRECT ${url}`);
});
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
const rpc = jest.fn<(fn: string, args: Record<string, unknown>) => Promise<RpcResult>>();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: (fn: string, args: Record<string, unknown>) => rpc(fn, args) }) }));
let staff: { doctor_tier: string } | null = { doctor_tier: "chief_medical_officer" };
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentClinicalStaff: async () => staff }));
jest.mock("@/lib/clinical/doctor-tier", () => ({ canAssignCases: (s: { doctor_tier: string } | null) => s?.doctor_tier === "chief_medical_officer" }));
const flashes: Array<{ notice: string; detail?: string; ok: boolean }> = [];
jest.mock("@/lib/go-live/flash", () => ({ setFlash: async (f: { notice: string; detail?: string; ok: boolean }) => { flashes.push(f); return "n1"; } }));

import { activatePagingDeliveryConfigAction, signTaskLayerConfigAction } from "./queue-paging-config-actions";

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const run = async (fn: (f: FormData) => Promise<void>, f: FormData) => { try { await fn(f); return "no redirect"; } catch (e) { return (e as Error).message; } };

beforeEach(() => { rpc.mockReset(); flashes.length = 0; staff = { doctor_tier: "chief_medical_officer" }; rpc.mockResolvedValue({ data: null, error: null }); });

describe("signing the task layer configuration", () => {
  it("signs exactly the version named, as the CMO, with the tick", async () => {
    expect(await run(signTaskLayerConfigAction, form({ understood: "on", version: "1" }))).toBe("REDIRECT /clinician/clinical-signoff?n=n1");
    expect(rpc).toHaveBeenCalledWith("sign_queue_task_layer_config", { p_version: 1 });
    expect(flashes[0]?.ok).toBe(true);
  });
  it("signs nothing without the tick, with a bad version, or for anyone but the CMO", async () => {
    await run(signTaskLayerConfigAction, form({ version: "1" }));
    await run(signTaskLayerConfigAction, form({ understood: "on", version: "abc" }));
    staff = { doctor_tier: "senior_medical_officer" };
    await run(signTaskLayerConfigAction, form({ understood: "on", version: "1" }));
    expect(rpc).not.toHaveBeenCalled();
    expect(flashes.every((f) => !f.ok)).toBe(true);
    expect(flashes[2]?.detail).toMatch(/Chief Medical Officer/);
  });
  it("shows the database's own sentence for a refusal and hides anything else", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "that version is already signed", code: "23514" } });
    await run(signTaskLayerConfigAction, form({ understood: "on", version: "1" }));
    expect(flashes[0]?.detail).toMatch(/already signed/);
    rpc.mockResolvedValue({ data: null, error: { message: "connection reset", code: "08006" } });
    await run(signTaskLayerConfigAction, form({ understood: "on", version: "1" }));
    expect(flashes[1]?.detail).not.toMatch(/connection/);
  });
});

describe("activating the paging delivery configuration", () => {
  it("reports success only when the database says it activated", async () => {
    rpc.mockResolvedValue({ data: { activated: true, reasons: [] }, error: null });
    await run(activatePagingDeliveryConfigAction, form({ understood: "on", version: "2" }));
    expect(rpc).toHaveBeenCalledWith("activate_paging_delivery_config", { p_version: 2 });
    expect(flashes[0]?.ok).toBe(true);
  });
  it("shows who is still missing what when the database refuses, and never reports success", async () => {
    rpc.mockResolvedValue({ data: { activated: false, reasons: [{ code: "clinician_not_ready", name: "Dr A", gaps: ["verified_email"] }] }, error: null });
    await run(activatePagingDeliveryConfigAction, form({ understood: "on", version: "2" }));
    expect(flashes[0]?.ok).toBe(false);
    expect(flashes[0]?.detail).toMatch(/Dr A: no verified email/);
    expect(flashes[0]?.detail).toMatch(/Nothing was changed/);
  });
  it("treats an answer it cannot read as not activated", async () => {
    rpc.mockResolvedValue({ data: { weird: true }, error: null });
    await run(activatePagingDeliveryConfigAction, form({ understood: "on", version: "2" }));
    expect(flashes[0]?.ok).toBe(false);
    rpc.mockResolvedValue({ data: null, error: null });
    await run(activatePagingDeliveryConfigAction, form({ understood: "on", version: "2" }));
    expect(flashes[1]?.ok).toBe(false);
  });
  it("calls nothing for anyone but the CMO or without the tick", async () => {
    await run(activatePagingDeliveryConfigAction, form({ version: "2" }));
    staff = null;
    await run(activatePagingDeliveryConfigAction, form({ understood: "on", version: "2" }));
    expect(rpc).not.toHaveBeenCalled();
  });
});
