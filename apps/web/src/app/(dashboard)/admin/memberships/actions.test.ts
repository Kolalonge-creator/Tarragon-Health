const rpc = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ rpc: (...args: unknown[]) => rpc(...args) }),
}));

import { endMembership, grantMembership } from "./actions";

const id = "11111111-1111-4111-8111-111111111111";
const form = (entries: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

beforeEach(() => rpc.mockReset());

describe("grantMembership", () => {
  it("refuses a short reason without calling the database", async () => {
    const r = await grantMembership(undefined, form({ base: "/admin/memberships", patient_id: id, reason: "short" }));
    expect(r?.error).toMatch(/reason/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("grants with no end date by omitting the argument", async () => {
    rpc.mockResolvedValue({ data: id, error: null });
    const r = await grantMembership(undefined, form({ base: "/admin/memberships", patient_id: id, reason: "Staff trial run", ends_on: "" }));
    expect(r?.message).toBeDefined();
    expect(rpc).toHaveBeenCalledWith("grant_membership", { p_patient: id, p_reason: "Staff trial run" });
  });
  it("sends the end date as the end of that day in Lagos", async () => {
    rpc.mockResolvedValue({ data: id, error: null });
    await grantMembership(undefined, form({ base: "/clinician/memberships", patient_id: id, reason: "Staff trial run", ends_on: "2027-01-31" }));
    expect(rpc).toHaveBeenCalledWith("grant_membership", { p_patient: id, p_ends_at: "2027-01-31T22:59:59.000Z", p_reason: "Staff trial run" });
  });
  it("maps an already-active membership to a sentence", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "membership_already_active", code: "P0001" } });
    const r = await grantMembership(undefined, form({ base: "/admin/memberships", patient_id: id, reason: "Staff trial run" }));
    expect(r?.error).toMatch(/already has an active/);
  });
});

describe("endMembership", () => {
  it("refuses a short reason", async () => {
    const r = await endMembership(undefined, form({ base: "/admin/memberships", patient_id: id, reason: "no" }));
    expect(r?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("ends and reports", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await endMembership(undefined, form({ base: "/admin/memberships", patient_id: id, reason: "Left the programme" }));
    expect(r?.message).toMatch(/ended/);
    expect(rpc).toHaveBeenCalledWith("end_membership", { p_patient: id, p_reason: "Left the programme" });
  });
  it("maps no active membership", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "membership_none_active", code: "P0002" } });
    const r = await endMembership(undefined, form({ base: "/admin/memberships", patient_id: id, reason: "Left the programme" }));
    expect(r?.error).toMatch(/no active membership/);
  });
});
