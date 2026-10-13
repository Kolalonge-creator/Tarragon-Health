const rpc = jest.fn();
const profile = jest.fn();
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: () => profile() }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { openPatientRecordAction, searchPatientsAction } from "./actions";

const ID = "11111111-1111-4111-8111-111111111111";
const record = { id: ID, full_name: "A", email: null, date_of_birth: null, sex: null, phone: null, city: null, state: null, patient_number: null, organisation_name: null, is_active: true, is_test: false, created_at: "2026-01-01", last_active_at: null, purchases: [] };

beforeEach(() => {
  rpc.mockReset();
  profile.mockReset();
  profile.mockResolvedValue({ id: "a", role: "admin" });
});

describe("searchPatientsAction", () => {
  it("refuses a non-admin before calling the database", async () => {
    profile.mockResolvedValue({ id: "c", role: "clinician" });
    expect(await searchPatientsAction("Mmesoma")).toEqual({ ok: false, error: "denied" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses a short query without calling the database", async () => {
    expect(await searchPatientsAction("ab")).toEqual({ ok: false, error: "query" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("sends the trimmed query to the function", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await searchPatientsAction("  Mmesoma ");
    expect(rpc).toHaveBeenCalledWith("admin_patient_search", { p_query: "Mmesoma" });
  });
  it("shows a database error as a failure, never as an empty list", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    expect(await searchPatientsAction("Mmesoma")).toEqual({ ok: false, error: "failed" });
  });
  it("treats a malformed answer as a failure", async () => {
    rpc.mockResolvedValue({ data: [{ patient_id: "nope" }], error: null });
    expect(await searchPatientsAction("Mmesoma")).toEqual({ ok: false, error: "failed" });
  });
});

describe("openPatientRecordAction", () => {
  it("refuses a non-admin", async () => {
    profile.mockResolvedValue(null);
    expect(await openPatientRecordAction(ID, "double charge reported")).toEqual({ ok: false, error: "denied" });
  });
  it("refuses a short reason before calling the database", async () => {
    expect(await openPatientRecordAction(ID, "short")).toEqual({ ok: false, error: "reason" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses a bad id", async () => {
    expect(await openPatientRecordAction("x", "double charge reported")).toEqual({ ok: false, error: "not_found" });
  });
  it("passes the reason to the function and returns the record", async () => {
    rpc.mockResolvedValue({ data: record, error: null });
    const r = await openPatientRecordAction(ID, " double charge reported ");
    expect(rpc).toHaveBeenCalledWith("admin_open_patient_record", { p_patient_id: ID, p_reason: "double charge reported" });
    expect(r.ok).toBe(true);
  });
  it("maps not found", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "x", code: "P0002" } });
    expect(await openPatientRecordAction(ID, "double charge reported")).toEqual({ ok: false, error: "not_found" });
  });
});
