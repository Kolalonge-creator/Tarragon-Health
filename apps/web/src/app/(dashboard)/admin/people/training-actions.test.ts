/**
 * HR Phase B training actions: each form field reaches the right RPC parameter, invalid forms are refused before any call,
 * and a database sentence reaches the admin while a raw error does not.
 */
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn(async () => ({ rpc })) }));

import { addRequirement, recordCompletion, saveCourse, setRequirementDue, verifyCompletion, voidCompletion } from "./training-actions";

const PERSON = "11111111-1111-4111-8111-111111111111";
const COURSE = "22222222-2222-4222-8222-222222222222";
const DEPT = "33333333-3333-4333-8333-333333333333";
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("saveCourse", () => {
  it("adds a mandatory course with a renewal period", async () => {
    expect(await saveCourse(undefined, form({ name: "Data protection", category: "mandatory", provider: "", description: "", renewalMonths: "12" }))).toEqual({ message: "Course added." });
    expect(rpc).toHaveBeenCalledWith("save_training_course", {
      p_id: null, p_name: "Data protection", p_category: "mandatory", p_provider: null, p_description: null, p_renewal_months: 12, p_active: true,
    });
  });
  it("refuses a renewal outside 1 to 120 months", async () => {
    expect((await saveCourse(undefined, form({ name: "X course", category: "mandatory", renewalMonths: "0" })))?.error).toMatch(/1 to 120/);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("addRequirement", () => {
  it("sends only the target that applies", async () => {
    await addRequirement(undefined, form({ courseId: COURSE, appliesTo: "department", departmentId: DEPT, role: "finance", dueWithinDays: "14" }));
    expect(rpc).toHaveBeenCalledWith("add_training_requirement", { p_course: COURSE, p_applies_to: "department", p_role: null, p_department: DEPT, p_due_within_days: 14 });
  });
  it("refuses a role rule with no role", async () => {
    expect((await addRequirement(undefined, form({ courseId: COURSE, appliesTo: "role", dueWithinDays: "30" })))?.error).toBe("Choose a role.");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("recordCompletion", () => {
  it("records an unverified completion by default and says it still needs verifying", async () => {
    const r = await recordCompletion(undefined, form({ profileId: PERSON, courseId: COURSE, completedOn: "2026-11-01", evidenceReference: "CERT-1", note: "" }));
    expect(r?.message).toMatch(/once another admin verifies/);
    expect(rpc).toHaveBeenCalledWith("record_training_completion", {
      p_profile: PERSON, p_course: COURSE, p_completed_on: "2026-11-01", p_verified: false, p_evidence_reference: "CERT-1", p_note: null,
    });
  });
  it("passes the verified tick", async () => {
    await recordCompletion(undefined, form({ profileId: PERSON, courseId: COURSE, completedOn: "2026-11-01", verified: "on" }));
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_verified: true });
  });
  it("passes the database's refusal through", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Another admin must verify your own training record." } });
    expect(await recordCompletion(undefined, form({ profileId: PERSON, courseId: COURSE, completedOn: "2026-11-01", verified: "on" }))).toEqual({
      error: "Another admin must verify your own training record.",
    });
  });
});

describe("setRequirementDue", () => {
  it("changes the due period in place", async () => {
    await setRequirementDue(undefined, form({ requirementId: COURSE, dueWithinDays: "14" }));
    expect(rpc).toHaveBeenCalledWith("set_training_requirement_due", { p_requirement: COURSE, p_due_within_days: 14 });
  });
  it("refuses more than a year", async () => {
    expect((await setRequirementDue(undefined, form({ requirementId: COURSE, dueWithinDays: "400" })))?.error).toBe("Give 0 to 365 days.");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("verify and void", () => {
  it("verifies by id", async () => {
    await verifyCompletion(undefined, form({ completionId: COURSE }));
    expect(rpc).toHaveBeenCalledWith("verify_training_completion", { p_completion: COURSE });
  });
  it("refuses a void without a real reason", async () => {
    expect((await voidCompletion(undefined, form({ completionId: COURSE, reason: "wrong" })))?.error).toMatch(/why this record is wrong/);
    expect(rpc).not.toHaveBeenCalled();
  });
});
