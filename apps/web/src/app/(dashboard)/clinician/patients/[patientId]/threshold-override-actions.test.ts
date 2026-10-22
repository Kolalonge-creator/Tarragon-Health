import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
const rpc = jest.fn<(fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>>();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: (fn: string, args: Record<string, unknown>) => rpc(fn, args) }) }));
let staff: { doctor_tier: string } | null = { doctor_tier: "senior_medical_officer" };
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentClinicalStaff: async () => staff }));
jest.mock("@/lib/clinical/doctor-tier", () => ({ hasPrescribingAuthority: (s: { doctor_tier: string } | null) => s?.doctor_tier === "senior_medical_officer" || s?.doctor_tier === "chief_medical_officer" }));

import { proposeThresholdOverride, revokeThresholdOverride, signThresholdOverride } from "./threshold-override-actions";

const PID = "11111111-1111-4111-8111-111111111111";
const OID = "22222222-2222-4222-8222-222222222222";
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const proposal = { patient_id: PID, domain: "bp", bp_target_systolic: "150", bp_target_diastolic: "95", reason: "Chronic baseline near 150 over 95 for two years", days: "60" };

beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: OID, error: null }); staff = { doctor_tier: "senior_medical_officer" }; });

describe("proposeThresholdOverride", () => {
  it("sends the parsed proposal to the database and says it has no effect until signed", async () => {
    expect(await proposeThresholdOverride(undefined, form(proposal))).toEqual({ success: "Proposed. It has no effect until it is signed." });
    expect(rpc).toHaveBeenCalledWith("propose_threshold_override", { p_patient: PID, p_domain: "bp", p_params: { target: { systolic: 150, diastolic: 95 } }, p_reason: proposal.reason, p_days: 60 });
  });
  it("does nothing for a coordinator-tier or missing staff record, or an out-of-limits setting", async () => {
    staff = { doctor_tier: "care_coordinator" };
    expect(await proposeThresholdOverride(undefined, form(proposal))).toMatchObject({ error: expect.stringMatching(/senior doctor/) });
    staff = null;
    expect(await proposeThresholdOverride(undefined, form(proposal))).toMatchObject({ error: expect.any(String) });
    staff = { doctor_tier: "senior_medical_officer" };
    expect(await proposeThresholdOverride(undefined, form({ ...proposal, bp_target_systolic: "175" }))).toMatchObject({ error: expect.stringMatching(/safety limits/) });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("shows a database refusal that was written for a person, and hides anything else", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "personal thresholds are not available in pregnancy", code: "22023" } });
    expect(await proposeThresholdOverride(undefined, form(proposal))).toEqual({ error: "personal thresholds are not available in pregnancy" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "relation x does not exist", code: "42P01" } });
    expect(await proposeThresholdOverride(undefined, form(proposal))).toEqual({ error: "That did not work. Nothing was saved. Please try again." });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "denied", code: "42501" } });
    expect(await proposeThresholdOverride(undefined, form(proposal))).toMatchObject({ error: expect.stringMatching(/care relationship/) });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "personal thresholds are not switched on", code: "55000" } });
    expect(await proposeThresholdOverride(undefined, form(proposal))).toEqual({ error: "personal thresholds are not switched on" });
  });
});

describe("signThresholdOverride", () => {
  it("signs only with the tick and the typed word", async () => {
    expect(await signThresholdOverride(undefined, form({ override_id: OID, patient_id: PID, typed: " sign ", understood: "on" }))).toMatchObject({ success: expect.stringMatching(/Signed/) });
    expect(rpc).toHaveBeenCalledWith("sign_threshold_override", { p_id: OID, p_confirm: "SIGN" });
    rpc.mockClear();
    expect(await signThresholdOverride(undefined, form({ override_id: OID, patient_id: PID, typed: "SIGN" }))).toMatchObject({ error: expect.stringMatching(/Nothing was signed/) });
    expect(await signThresholdOverride(undefined, form({ override_id: OID, patient_id: PID, typed: "SING", understood: "on" }))).toMatchObject({ error: expect.stringMatching(/Nothing was signed/) });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses a non-senior doctor, a bad id, and surfaces a database refusal", async () => {
    staff = { doctor_tier: "care_coordinator" };
    expect(await signThresholdOverride(undefined, form({ override_id: OID, patient_id: PID, typed: "SIGN", understood: "on" }))).toMatchObject({ error: expect.stringMatching(/senior doctor/) });
    staff = { doctor_tier: "chief_medical_officer" };
    expect(await signThresholdOverride(undefined, form({ override_id: "x", patient_id: PID, typed: "SIGN", understood: "on" }))).toMatchObject({ error: expect.stringMatching(/could not be found/) });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom", code: "XX000" } });
    expect(await signThresholdOverride(undefined, form({ override_id: OID, patient_id: PID, typed: "SIGN", understood: "on" }))).toMatchObject({ error: expect.stringMatching(/Nothing was saved/) });
  });
});

describe("revokeThresholdOverride", () => {
  it("ends an override with a reason", async () => {
    expect(await revokeThresholdOverride(undefined, form({ override_id: OID, patient_id: PID, reason: "No longer needed" }))).toMatchObject({ success: expect.stringMatching(/default thresholds apply again/) });
    expect(rpc).toHaveBeenCalledWith("revoke_threshold_override", { p_id: OID, p_reason: "No longer needed" });
  });
  it("needs a senior doctor, a valid id and a reason, and shows a refusal", async () => {
    staff = null;
    expect(await revokeThresholdOverride(undefined, form({ override_id: OID, patient_id: PID, reason: "No longer needed" }))).toMatchObject({ error: expect.stringMatching(/senior doctor/) });
    staff = { doctor_tier: "senior_medical_officer" };
    expect(await revokeThresholdOverride(undefined, form({ override_id: "x", patient_id: PID, reason: "No longer needed" }))).toMatchObject({ error: expect.stringMatching(/could not be found/) });
    expect(await revokeThresholdOverride(undefined, form({ override_id: OID, patient_id: PID, reason: "no" }))).toMatchObject({ error: expect.stringMatching(/at least 5/) });
    expect(await revokeThresholdOverride(undefined, form({ override_id: OID, patient_id: PID }))).toMatchObject({ error: expect.stringMatching(/at least 5/) });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "this override has already ended", code: "22023" } });
    expect(await revokeThresholdOverride(undefined, form({ override_id: OID, patient_id: PID, reason: "No longer needed" }))).toEqual({ error: "this override has already ended" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
