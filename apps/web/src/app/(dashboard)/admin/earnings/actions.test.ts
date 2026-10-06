const rpc = jest.fn();
const taskTypes = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({ select: () => ({ eq: () => ({ order: () => taskTypes() }) }) }),
  }),
}));

import { approveFeeSchedule, discardFeeScheduleDraft, postEarningsAdjustment, saveFeeScheduleDraft } from "./actions";

const id = "11111111-1111-4111-8111-111111111111";
const form = (entries: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};
const scheduleForm = (over: Record<string, string> = {}) =>
  form({
    base_symptom_review: "300",
    on_call_shift_fee: "20000",
    lead_fee: "1500",
    pilot_minimum: "2500",
    share_video: "60",
    share_audio: "50",
    share_phone: "40",
    ...over,
  });

beforeEach(() => {
  rpc.mockReset();
  taskTypes.mockReset();
  taskTypes.mockResolvedValue({ data: [{ code: "symptom_review" }], error: null });
});

describe("saveFeeScheduleDraft", () => {
  it("creates a draft with kobo items built on the server and the task types the database lists", async () => {
    rpc.mockResolvedValue({ data: id, error: null });
    const r = await saveFeeScheduleDraft(undefined, scheduleForm());
    expect(r?.message).toMatch(/Draft saved/);
    expect(rpc).toHaveBeenCalledWith("create_fee_schedule_draft", {
      p_items: {
        task_types: { symptom_review: { base_fee_kobo: 30000, wait_multiplier_steps: [] } },
        on_call_shift_fee_kobo: 2000000,
        lead_fee_per_patient_month_kobo: 150000,
        consultation_share_pct: { video: 60, audio: 50, phone: 40 },
        pilot_minimum_per_declared_hour_kobo: 250000,
      },
    });
  });
  it("a blank money box is refused without calling the database", async () => {
    const r = await saveFeeScheduleDraft(undefined, scheduleForm({ lead_fee: "" }));
    expect(r?.error).toMatch(/lead fee/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("updates the draft it was opened from", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await saveFeeScheduleDraft(undefined, scheduleForm({ draft_id: id, note: "pilot" }));
    expect(r?.message).toBe("Draft saved.");
    expect(rpc.mock.calls[0]?.[0]).toBe("update_fee_schedule_draft");
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_id: id, p_note: "pilot" });
  });
  it("refuses a draft id that is not an id", async () => {
    const r = await saveFeeScheduleDraft(undefined, scheduleForm({ draft_id: "nope" }));
    expect(r?.error).toMatch(/could not be found/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("says so when the task types could not be loaded", async () => {
    taskTypes.mockResolvedValue({ data: null, error: { message: "x" } });
    const r = await saveFeeScheduleDraft(undefined, scheduleForm());
    expect(r?.error).toMatch(/task types could not be loaded/);
  });
  it("maps a database refusal to a sentence", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "fee_not_authorised" } });
    expect((await saveFeeScheduleDraft(undefined, scheduleForm()))?.error).toMatch(/do not have access/);
    rpc.mockResolvedValue({ data: null, error: { message: "fee_not_a_draft" } });
    expect((await saveFeeScheduleDraft(undefined, scheduleForm({ draft_id: id })))?.error).toMatch(/Only a draft/);
  });
});

describe("approveFeeSchedule and discardFeeScheduleDraft", () => {
  it("approves and names the task types that have no fee", async () => {
    rpc.mockResolvedValue({ data: { task_types_without_fee: ["titration_signoff"] }, error: null });
    const r = await approveFeeSchedule(undefined, form({ schedule_id: id }));
    expect(r?.message).toMatch(/titration_signoff/);
    expect(rpc).toHaveBeenCalledWith("approve_fee_schedule", { p_id: id });
  });
  it("approves with nothing missing", async () => {
    rpc.mockResolvedValue({ data: { task_types_without_fee: [] }, error: null });
    expect((await approveFeeSchedule(undefined, form({ schedule_id: id })))?.message).toMatch(/applies to work finished from now on/);
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await approveFeeSchedule(undefined, form({ schedule_id: id })))?.message).toMatch(/Approved/);
  });
  it("refuses a bad id and maps database errors", async () => {
    expect((await approveFeeSchedule(undefined, form({ schedule_id: "x" })))?.error).toBeDefined();
    expect((await discardFeeScheduleDraft(undefined, form({ schedule_id: "x" })))?.error).toBeDefined();
    rpc.mockResolvedValue({ data: null, error: { message: "fee_not_a_draft" } });
    expect((await approveFeeSchedule(undefined, form({ schedule_id: id })))?.error).toMatch(/Only a draft/);
    expect((await discardFeeScheduleDraft(undefined, form({ schedule_id: id })))?.error).toMatch(/Only a draft/);
  });
  it("discards", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await discardFeeScheduleDraft(undefined, form({ schedule_id: id })))?.message).toBe("Draft discarded.");
  });
});

describe("postEarningsAdjustment", () => {
  const base = { clinician_id: id, direction: "add", amount: "500", reason: "Agreed fee for this question" };
  it("adds, converting naira to kobo and passing the request id and the line corrected", async () => {
    rpc.mockResolvedValue({ data: id, error: null });
    const request = "22222222-2222-4222-8222-222222222222";
    const r = await postEarningsAdjustment(undefined, form({ ...base, corrects: id, request_id: request }));
    expect(r?.message).toMatch(/posted/);
    expect(rpc).toHaveBeenCalledWith("post_earnings_adjustment", { p_clinician: id, p_amount_kobo: 50000, p_reason: base.reason, p_corrects: id, p_request_id: request });
  });
  it("takes away as a negative amount and leaves out an invalid request id", async () => {
    rpc.mockResolvedValue({ data: id, error: null });
    await postEarningsAdjustment(undefined, form({ ...base, direction: "take_away", request_id: "bad" }));
    expect(rpc).toHaveBeenCalledWith("post_earnings_adjustment", { p_clinician: id, p_amount_kobo: -50000, p_reason: base.reason });
  });
  it("refuses a zero or blank amount and a short reason without calling the database", async () => {
    expect((await postEarningsAdjustment(undefined, form({ ...base, amount: "0" })))?.error).toMatch(/more than zero/);
    expect((await postEarningsAdjustment(undefined, form({ ...base, amount: "" })))?.error).toMatch(/more than zero/);
    expect((await postEarningsAdjustment(undefined, form({ ...base, reason: "short" })))?.error).toMatch(/reason/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps a salaried clinician to a sentence", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "earnings_not_contracted" } });
    expect((await postEarningsAdjustment(undefined, form(base)))?.error).toMatch(/salary/);
  });
});
