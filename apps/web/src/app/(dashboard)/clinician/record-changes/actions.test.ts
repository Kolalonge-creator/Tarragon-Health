/**
 * S05b-e: the two decision actions on the record changes queue.
 *   - a Care Coordinator (or anyone with no clinical tier) is refused BEFORE the database is called;
 *   - input is validated with Zod (a bad id never reaches the database, a long note is refused);
 *   - the database's own refusal is shown to the caller, never swallowed;
 *   - a reject note is passed on as the internal note only when it has text.
 */
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const rpc = jest.fn();
let staff: { doctor_tier: string | null } | null = { doctor_tier: "senior_medical_officer" };

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({ rpc })),
}));
jest.mock("@/lib/auth/current-profile", () => ({
  getCurrentClinicalStaff: jest.fn(async () => staff),
}));

import { revalidatePath } from "next/cache";
import { confirmRecordChange, rejectRecordChange } from "./actions";

const ID = "6f1d6b3e-3f43-4c1e-9d0e-3b1c3a1f2a10";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: {}, error: null });
  (revalidatePath as jest.Mock).mockClear();
  staff = { doctor_tier: "senior_medical_officer" };
});

describe("confirmRecordChange", () => {
  it("calls the confirm function with the request id and refreshes the queue", async () => {
    const result = await confirmRecordChange(undefined, form({ id: ID }));
    expect(rpc).toHaveBeenCalledWith("confirm_patient_allergy_correction", { p_request_id: ID });
    expect(result?.error).toBeUndefined();
    expect(result?.message).toBeTruthy();
    expect(revalidatePath).toHaveBeenCalledWith("/clinician/record-changes");
  });

  it("refuses a care coordinator without calling the database", async () => {
    staff = { doctor_tier: "care_coordinator" };
    const result = await confirmRecordChange(undefined, form({ id: ID }));
    expect(result?.error).toMatch(/only a doctor/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an account with no clinical staff row", async () => {
    staff = null;
    const result = await confirmRecordChange(undefined, form({ id: ID }));
    expect(result?.error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a uuid", async () => {
    const result = await confirmRecordChange(undefined, form({ id: "not-an-id" }));
    expect(result?.error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the database's refusal instead of swallowing it", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "you cannot resolve this request" } });
    const result = await confirmRecordChange(undefined, form({ id: ID }));
    expect(result?.error).toBe("you cannot resolve this request");
    expect(result?.message).toBeUndefined();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("rejectRecordChange", () => {
  it("passes the trimmed internal note to the reject function", async () => {
    const result = await rejectRecordChange(undefined, form({ id: ID, note: "  checked the chart  " }));
    expect(rpc).toHaveBeenCalledWith("reject_patient_allergy_correction", { p_request_id: ID, p_note: "checked the chart" });
    expect(result?.error).toBeUndefined();
    expect(revalidatePath).toHaveBeenCalledWith("/clinician/record-changes");
  });

  it("sends no note when the box is empty or blank", async () => {
    await rejectRecordChange(undefined, form({ id: ID, note: "   " }));
    expect(rpc).toHaveBeenCalledWith("reject_patient_allergy_correction", { p_request_id: ID });
  });

  it("refuses a care coordinator without calling the database", async () => {
    staff = { doctor_tier: "care_coordinator" };
    const result = await rejectRecordChange(undefined, form({ id: ID, note: "x" }));
    expect(result?.error).toMatch(/only a doctor/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a note over 1000 characters and a bad id", async () => {
    const tooLong = await rejectRecordChange(undefined, form({ id: ID, note: "a".repeat(1001) }));
    expect(tooLong?.error).toMatch(/1000/);
    const badId = await rejectRecordChange(undefined, form({ id: "nope" }));
    expect(badId?.error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the database's refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "this request was already decided" } });
    const result = await rejectRecordChange(undefined, form({ id: ID }));
    expect(result?.error).toBe("this request was already decided");
  });
});
