import { describe, expect, it } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { readMyThresholdNotice, readOversightRoster, readPatientOverrides, readThresholdHubState } from "./threshold-overrides";

const rpcClient = (data: unknown, error: unknown = null) => ({ rpc: async () => ({ data, error }) }) as unknown as SupabaseClient<Database>;
const throwing = { rpc: () => { throw new Error("x"); }, from: () => { throw new Error("x"); } } as unknown as SupabaseClient<Database>;
const fromClient = (data: unknown, error: unknown = null) =>
  ({ from: () => ({ select: () => ({ eq: () => ({ in: () => ({ order: async () => ({ data, error }) }) }) }) }) }) as unknown as SupabaseClient<Database>;

describe("threshold override readers", () => {
  it("hub state: policy waiting, live, and a failure that is never an all-clear", async () => {
    expect(await readThresholdHubState(rpcClient({ policyActive: false, policyVersionWaiting: 1, policyIdWaiting: "pid", active: 0, reviewsOverdue: 0 }))).toMatchObject({ policyWaiting: true, policyVersion: 1, policyId: "pid", failed: false });
    expect(await readThresholdHubState(rpcClient({ policyActive: true, policyVersionWaiting: null, active: "3", reviewsOverdue: 2 }))).toMatchObject({ policyWaiting: false, policyActive: true, active: 3, reviewsOverdue: 2 });
    expect(await readThresholdHubState(rpcClient({}))).toMatchObject({ policyWaiting: false, active: 0, failed: false });
    expect((await readThresholdHubState(rpcClient(null, { code: "42501" }))).failed).toBe(true);
    expect((await readThresholdHubState(rpcClient(null))).failed).toBe(true);
    expect((await readThresholdHubState(rpcClient("x"))).failed).toBe(true);
    expect((await readThresholdHubState(throwing)).failed).toBe(true);
  });
  it("patient overrides and roster report a failed read", async () => {
    expect(await readPatientOverrides(fromClient([{ id: "a" }]), "p")).toEqual({ rows: [{ id: "a" }], failed: false });
    expect((await readPatientOverrides(fromClient(null, { m: 1 }), "p")).failed).toBe(true);
    expect((await readPatientOverrides(fromClient(null), "p")).failed).toBe(true);
    expect((await readPatientOverrides(throwing, "p")).failed).toBe(true);
    expect(await readOversightRoster(rpcClient([{ id: "a" }]))).toEqual({ rows: [{ id: "a" }], failed: false });
    expect((await readOversightRoster(rpcClient({}))).failed).toBe(true);
    expect((await readOversightRoster(rpcClient(null, { m: 1 }))).failed).toBe(true);
    expect((await readOversightRoster(throwing)).failed).toBe(true);
  });
  it("the patient notice is true only on a clean yes", async () => {
    expect(await readMyThresholdNotice(rpcClient(true))).toBe(true);
    expect(await readMyThresholdNotice(rpcClient(false))).toBe(false);
    expect(await readMyThresholdNotice(rpcClient(true, { m: 1 }))).toBe(false);
    expect(await readMyThresholdNotice(throwing)).toBe(false);
  });
});
