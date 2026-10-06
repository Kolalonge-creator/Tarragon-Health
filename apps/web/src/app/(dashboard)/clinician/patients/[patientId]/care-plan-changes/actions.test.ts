/**
 * S24 server actions for the care plan changes panel: valid input reaches the right database function with the signed-in session,
 * invalid input never does, a refusal becomes a readable sentence, a signing safety stop is returned for the form to answer, and
 * nothing internal leaks into a message.
 */
const rpc = jest.fn();
const getUser = jest.fn();
const fromSelectIn = jest.fn();
const revalidatePath = jest.fn();
const suggestTitration = jest.fn();

jest.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: { getUser: () => getUser() },
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({ select: () => ({ in: (...args: unknown[]) => fromSelectIn(...args) }) }),
  }),
}));
jest.mock("@/lib/care-changes/suggest-titration", () => ({ suggestTitration: (id: string) => suggestTitration(id) }), { virtual: true });

import { listCareChanges, proposeMedicineChange, proposeScheduleChange, proposeTargetChange, rejectCareChange, signCareChange, suggestNextStep } from "./actions";

const PATIENT = "6f1c2a52-8c0e-4d57-9b7f-0d2b6a1f4e11";
const CHANGE = "7a1c2a52-8c0e-4d57-9b7f-0d2b6a1f4e22";
const PLAN = "8b1c2a52-8c0e-4d57-9b7f-0d2b6a1f4e33";
const RATIONALE = "Home readings stay above the target";
const ITEM = { drug_name: "Amlodipine", dose: "10 mg", duration_days: "30", quantity: "30 tablets" };

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: CHANGE, error: null });
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "clin-1" } } });
  fromSelectIn.mockReset().mockResolvedValue({ data: [{ profile_id: "clin-1", full_name: "Dr Ade" }] });
  revalidatePath.mockReset();
  suggestTitration.mockReset();
});

describe("not signed in", () => {
  it("every action refuses and calls nothing", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const results = await Promise.all([
      listCareChanges({ patientId: PATIENT }),
      suggestNextStep({ patientId: PATIENT }),
      proposeMedicineChange({ action: "stop", patientId: PATIENT, medicationId: CHANGE, rationale: RATIONALE }),
      signCareChange({ patientId: PATIENT, changeId: CHANGE, patientSummary: "Your care team has a change for you." }),
      rejectCareChange({ patientId: PATIENT, changeId: CHANGE, reason: "No" }),
    ]);
    for (const r of results) expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(suggestTitration).not.toHaveBeenCalled();
  });
});

describe("listCareChanges", () => {
  it("reads through the audited function with a reason and resolves names", async () => {
    rpc.mockResolvedValue({
      data: [{ id: CHANGE, kind: "medication", state: "signed", proposed_by: "clinician", proposed_by_user: "clin-1", signed_by: "clin-1", proposal: { action: "stop" }, rationale: "Because" }],
      error: null,
    });
    const result = await listCareChanges({ patientId: PATIENT });
    expect(rpc).toHaveBeenCalledWith("list_care_plan_changes", { p_patient: PATIENT, p_reason: expect.stringMatching(/care plan changes/i) });
    expect(result.ok && result.changes[0]?.signedByName).toBe("Dr Ade");
  });

  it("a refusal is an error message, never an empty list", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Not authorised to see these changes" } });
    const result = await listCareChanges({ patientId: PATIENT });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/not allowed/i);
  });

  it("rejects a bad patient id without calling the database", async () => {
    expect((await listCareChanges({ patientId: "x" })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("proposeMedicineChange", () => {
  it("sends a clinician proposal with the built shape and revalidates the chart", async () => {
    const result = await proposeMedicineChange({ action: "start", patientId: PATIENT, item: ITEM, rationale: RATIONALE });
    expect(result).toEqual({ ok: true, id: CHANGE });
    expect(rpc).toHaveBeenCalledWith("propose_care_plan_change", {
      p_patient: PATIENT,
      p_kind: "medication",
      p_proposal: { action: "start", item: { drug_name: "Amlodipine", dose: "10 mg", duration_days: 30, quantity: "30 tablets" } },
      p_rationale: RATIONALE,
      p_care_plan_id: undefined,
      p_proposed_by: "clinician",
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/clinician/patients/${PATIENT}`);
  });

  it("invalid input never reaches the database", async () => {
    const result = await proposeMedicineChange({ action: "start", patientId: PATIENT, item: { ...ITEM, quantity: "" }, rationale: RATIONALE });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("an authorization failure reads as a sentence with no codes or internals", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "new row violates row-level security policy for table x", details: "secret detail" } });
    const result = await proposeMedicineChange({ action: "stop", patientId: PATIENT, medicationId: CHANGE, rationale: RATIONALE });
    expect(result.ok).toBe(false);
    const message = !result.ok ? result.error : "";
    expect(message).toMatch(/prescriber tied to this patient/);
    expect(message).not.toMatch(/row-level|secret|42501/);
  });

  it("a rule the function states (22023) is shown as written; an unknown failure is generic", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "That is not a current prescription for this patient" } });
    const stated = await proposeMedicineChange({ action: "stop", patientId: PATIENT, medicationId: CHANGE, rationale: RATIONALE });
    expect(!stated.ok && stated.error).toBe("That is not a current prescription for this patient");
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "relation \"care_plan_changes\" blew up at /var/db" } });
    const unknown = await proposeMedicineChange({ action: "stop", patientId: PATIENT, medicationId: CHANGE, rationale: RATIONALE });
    expect(!unknown.ok && unknown.error).toMatch(/nothing was changed/i);
    expect(!unknown.ok && unknown.error).not.toMatch(/blew up|\/var/);
  });
});

describe("proposeTargetChange and proposeScheduleChange", () => {
  it("send the care plan id and the built proposal", async () => {
    await proposeTargetChange({ patientId: PATIENT, carePlanId: PLAN, rationale: RATIONALE, entries: [{ key: "pulse", min: "", max: "100" }] });
    expect(rpc).toHaveBeenLastCalledWith("propose_care_plan_change", expect.objectContaining({ p_kind: "target", p_care_plan_id: PLAN, p_proposal: { target_ranges: { pulse: { max: 100 } } } }));
    await proposeScheduleChange({ patientId: PATIENT, carePlanId: PLAN, rationale: RATIONALE, entries: [{ key: "bp", value: "twice a day" }] });
    expect(rpc).toHaveBeenLastCalledWith("propose_care_plan_change", expect.objectContaining({ p_kind: "reading_schedule", p_proposal: { reading_schedule: { bp: "twice a day" } } }));
  });

  it("refuses a target without a care plan id", async () => {
    const result = await proposeTargetChange({ patientId: PATIENT, carePlanId: "", rationale: RATIONALE, entries: [{ key: "pulse", max: "100" }] });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("signCareChange", () => {
  const input = { patientId: PATIENT, changeId: CHANGE, patientSummary: "Your care team wants to raise your dose." };

  it("signs with the summary and defaults the allergy confirmation to false", async () => {
    const result = await signCareChange(input);
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("sign_care_plan_change", {
      p_change: CHANGE,
      p_patient_summary: "Your care team wants to raise your dose.",
      p_allergies_confirmed: false,
      p_safety_override_reason: undefined,
    });
  });

  it("passes the confirmation and the reason when the signer answers a safety stop", async () => {
    await signCareChange({ ...input, allergiesConfirmed: true, overrideReason: " Tolerated before " });
    expect(rpc).toHaveBeenCalledWith("sign_care_plan_change", expect.objectContaining({ p_allergies_confirmed: true, p_safety_override_reason: "Tolerated before" }));
  });

  it("returns a SAFETY_FINDINGS stop as structured findings for the form", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "A safety check needs your attention before this can be signed.", details: "SAFETY_FINDINGS", hint: JSON.stringify([{ code: "allergy_match", allergen: "Penicillin" }]) },
    });
    const result = await signCareChange(input);
    expect(result).toMatchObject({ ok: false, safety: { kind: "findings", findings: [{ code: "allergy_match", allergen: "Penicillin" }] } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns SAFETY_BLOCKED as blocked with no override path", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "x", details: "SAFETY_BLOCKED", hint: "[]" } });
    const result = await signCareChange({ ...input, overrideReason: "please" });
    expect(result).toMatchObject({ ok: false, safety: { kind: "blocked" } });
    expect(!result.ok && result.error).toMatch(/does not prescribe controlled medicines/);
  });

  it("refuses a missing summary before calling the database", async () => {
    const result = await signCareChange({ ...input, patientSummary: "" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("an authorization failure is readable", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Not authorised to sign this change" } });
    const result = await signCareChange(input);
    expect(!result.ok && result.error).toMatch(/not allowed/i);
  });
});

describe("rejectCareChange", () => {
  it("rejects with a reason and refuses an empty one", async () => {
    expect((await rejectCareChange({ patientId: PATIENT, changeId: CHANGE, reason: "Not needed now" })).ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("reject_care_plan_change", { p_change: CHANGE, p_reason: "Not needed now" });
    rpc.mockClear();
    expect((await rejectCareChange({ patientId: PATIENT, changeId: CHANGE, reason: "  " })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("suggestNextStep", () => {
  it("passes a proposal, a no-proposal with every reason, and no-protocol through", async () => {
    suggestTitration.mockResolvedValueOnce({ kind: "proposed", changeId: CHANGE, result: {} });
    expect(await suggestNextStep({ patientId: PATIENT })).toEqual({ ok: true, kind: "proposed", changeId: CHANGE });
    expect(revalidatePath).toHaveBeenCalled();
    suggestTitration.mockResolvedValueOnce({ kind: "no_proposal", reasons: [{ code: "low_adherence", detail: "40%" }, { code: "too_few_readings" }] });
    expect(await suggestNextStep({ patientId: PATIENT })).toEqual({ ok: true, kind: "no_proposal", reasons: [{ code: "low_adherence", detail: "40%" }, { code: "too_few_readings" }] });
    suggestTitration.mockResolvedValueOnce({ kind: "no_protocol" });
    expect(await suggestNextStep({ patientId: PATIENT })).toEqual({ ok: true, kind: "no_protocol" });
  });

  it("an evaluator error or a thrown exception is a readable failure with no internals", async () => {
    suggestTitration.mockResolvedValueOnce({ kind: "error", message: "That is not available to you." });
    expect(await suggestNextStep({ patientId: PATIENT })).toEqual({ ok: false, error: "That is not available to you." });
    suggestTitration.mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.1:5432 password=hunter2"));
    const result = await suggestNextStep({ patientId: PATIENT });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/ECONNREFUSED|hunter2/);
  });

  it("rejects a bad patient id", async () => {
    expect((await suggestNextStep({ patientId: "x" })).ok).toBe(false);
    expect(suggestTitration).not.toHaveBeenCalled();
  });
});
