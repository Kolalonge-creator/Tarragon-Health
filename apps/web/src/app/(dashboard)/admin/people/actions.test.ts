/**
 * HR Phase A server actions. The rules live in the database; these tests pin that each form field reaches the right RPC
 * parameter, that the form is validated before any call, that a database sentence reaches the admin, and a raw error does not.
 */
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn(async () => ({ rpc })) }));

import { recordEmploymentChange, saveDepartment, savePersonalDetails } from "./actions";

const PERSON = "11111111-1111-4111-8111-111111111111";
const DEPT = "22222222-2222-4222-8222-222222222222";
const BOSS = "33333333-3333-4333-8333-333333333333";
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const employment = (over: Record<string, string> = {}) =>
  form({
    profileId: PERSON,
    changeKind: "transfer",
    effectiveFrom: "2026-11-07",
    jobTitle: " Data analyst ",
    workPattern: "full_time",
    employmentStatus: "active",
    startDate: "2026-01-05",
    departmentId: DEPT,
    lineManagerId: BOSS,
    engagement: "employed",
    contractEndDate: "",
    hours: "37.5",
    workLocation: "Lagos",
    note: "",
    ...over,
  });

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("recordEmploymentChange", () => {
  it("maps every field to its own RPC parameter", async () => {
    expect(await recordEmploymentChange(undefined, employment())).toEqual({ message: "Saved to their employment history." });
    expect(rpc).toHaveBeenCalledWith("record_staff_employment_change", {
      p_profile: PERSON,
      p_change_kind: "transfer",
      p_effective_from: "2026-11-07",
      p_job_title: "Data analyst",
      p_work_pattern: "full_time",
      p_employment_status: "active",
      p_start_date: "2026-01-05",
      p_department: DEPT,
      p_line_manager: BOSS,
      p_engagement: "employed",
      p_contract_end_date: null,
      p_contracted_hours: 37.5,
      p_work_location: "Lagos",
      p_note: null,
    });
  });

  it("sends no engagement for a clinician (the field is absent from the form)", async () => {
    const fd = employment();
    fd.delete("engagement");
    await recordEmploymentChange(undefined, fd);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_engagement: null });
  });

  it("refuses a resignation with no note before calling the database", async () => {
    const r = await recordEmploymentChange(undefined, employment({ changeKind: "resignation", employmentStatus: "left", note: "short" }));
    expect(r?.error).toMatch(/at least 10 characters/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a contract that ends before it starts", async () => {
    const r = await recordEmploymentChange(undefined, employment({ contractEndDate: "2025-12-31" }));
    expect(r?.error).toMatch(/before the start date/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes a database sentence through and hides a raw error", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "That would make a reporting loop." } });
    expect(await recordEmploymentChange(undefined, employment())).toEqual({ error: "That would make a reporting loop." });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "internal detail" } });
    expect(await recordEmploymentChange(undefined, employment())).toEqual({ error: "Something went wrong. Please try again." });
  });
});

describe("saveDepartment", () => {
  it("adds a new department as active, with no id", async () => {
    await saveDepartment(undefined, form({ name: "Operations", description: "", headId: "" }));
    expect(rpc).toHaveBeenCalledWith("save_staff_department", { p_id: null, p_name: "Operations", p_description: null, p_head: null, p_active: true });
  });

  it("retires an existing department", async () => {
    await saveDepartment(undefined, form({ id: DEPT, name: "Operations", headId: BOSS, active: "false" }));
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_id: DEPT, p_head: BOSS, p_active: false });
  });
});

describe("savePersonalDetails", () => {
  it("normalises spaces in the phone and ID number", async () => {
    await savePersonalDetails(undefined, form({ profileId: PERSON, emergencyName: "Ada Obi", emergencyPhone: "+234 803 123 4567", nationalId: "123 4567 8901", homeAddress: "" }));
    expect(rpc).toHaveBeenCalledWith("set_staff_personal_details", {
      p_profile: PERSON,
      p_emergency_contact_name: "Ada Obi",
      p_emergency_contact_relationship: null,
      p_emergency_contact_phone: "+2348031234567",
      p_home_address: null,
      p_national_id_number: "12345678901",
    });
  });

  it("refuses a local-format phone and a short ID before calling the database", async () => {
    expect((await savePersonalDetails(undefined, form({ profileId: PERSON, emergencyPhone: "08031234567" })))?.error).toMatch(/international form/);
    expect((await savePersonalDetails(undefined, form({ profileId: PERSON, nationalId: "12345" })))?.error).toMatch(/11 digits/);
    expect(rpc).not.toHaveBeenCalled();
  });
});
