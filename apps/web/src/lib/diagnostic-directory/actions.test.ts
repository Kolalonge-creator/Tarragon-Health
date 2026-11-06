const rpc = jest.fn();
const redirect = jest.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { addBranchAction, createFacilityAction, recordCredentialAction, saveServiceAction, setStatusAction, verifyLocationAction } from "./actions";

const L = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const fd = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => (Array.isArray(v) ? v.forEach((x) => f.append(k, x)) : f.set(k, v)));
  return f;
};
const goes = async (p: Promise<void>) => p.then(() => "no redirect", (e: Error) => e.message);
const BASE = "REDIRECT:/admin/ops/diagnostic-directory";
const branch = { branch_name: "Lekki", state: "Lagos", town: "Lekki", lga: "Eti-Osa", address: "5 Admiralty Way", phone: "+2348011111111", latitude: "6.44", longitude: "3.47" };

beforeEach(() => {
  rpc.mockReset();
  redirect.mockClear();
});

describe("createFacilityAction", () => {
  it("creates an uncontracted draft and opens it", async () => {
    rpc.mockResolvedValue({ data: L, error: null });
    expect(await goes(createFacilityAction(fd({ kind: "imaging", name: "Scan Centre", ...branch })))).toBe(`${BASE}/${L}?n=facility_created`);
    expect(rpc).toHaveBeenCalledWith("admin_dx_create_facility", expect.objectContaining({
      p_kind: "imaging", p_name: "Scan Centre", p_phone: "+2348011111111", p_latitude: 6.44, p_longitude: 3.47, p_is_test: false,
    }));
  });
  it("sends empty optional numbers and phone as null", async () => {
    rpc.mockResolvedValue({ data: L, error: null });
    await goes(createFacilityAction(fd({ kind: "lab", name: "Lab", ...branch, phone: "", latitude: "", longitude: "", lga: "" })));
    expect(rpc).toHaveBeenCalledWith("admin_dx_create_facility", expect.objectContaining({ p_phone: null, p_latitude: null, p_longitude: null, p_lga: null }));
  });
  it("refuses a malformed phone before calling the database", async () => {
    expect(await goes(createFacilityAction(fd({ kind: "lab", name: "Lab", ...branch, phone: "08011111111" })))).toBe(`${BASE}?n=invalid`);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a refusal is denied, never a success", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "x", code: "42501" } });
    expect(await goes(createFacilityAction(fd({ kind: "lab", name: "Lab", ...branch })))).toBe(`${BASE}?n=denied`);
  });
});

describe("addBranchAction", () => {
  it("a contracted provider's refusal says to use the partner screen", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "x", code: "42501" } });
    expect(await goes(addBranchAction(fd({ listing_id: L, ...branch })))).toBe(`${BASE}/${L}?n=contracted_branch`);
  });
});

describe("setStatusAction", () => {
  it("a rule refusal (listing before the location check) is shown as such", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "x", code: "23514" } });
    expect(await goes(setStatusAction(fd({ listing_id: L, level: "branch", target_id: B, status: "listed", reason: "checked by phone today" }))))
      .toBe(`${BASE}/${L}?n=rule_refused`);
  });
  it("a short reason never reaches the database", async () => {
    expect(await goes(setStatusAction(fd({ listing_id: L, level: "branch", target_id: B, status: "listed", reason: "ok" })))).toBe(`${BASE}/${L}?n=invalid`);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("saveServiceAction", () => {
  it("passes the confirmation through, with no performer for an onsite test", async () => {
    rpc.mockResolvedValue({ data: C, error: null });
    expect(await goes(saveServiceAction(fd({
      listing_id: L, branch_listing_id: B, concept_id: C, availability: "available", performed: "onsite",
      performing_branch_listing_id: "", appointment_required: "on", preparation_note: "", evidence_source: "Phone call with manager",
    })))).toBe(`${BASE}/${L}?n=service_saved`);
    expect(rpc).toHaveBeenCalledWith("admin_dx_upsert_service", expect.objectContaining({
      p_performing_branch_listing_id: null, p_appointment_required: true, p_preparation_note: null, p_evidence_source: "Phone call with manager",
    }));
  });
});

describe("recordCredentialAction", () => {
  it("sends the chosen scope tests, or null for a whole-facility registration", async () => {
    rpc.mockResolvedValue({ data: C, error: null });
    const base = { listing_id: L, level: "provider", target_id: L, regulator: "mlscn_registration", issuer: "MLSCN", identifier: "MLSCN/1",
      accreditation_body: "", state: "", issued_on: "", expires_on: "2027-01-01", source_url: "https://web.mlscn.gov.ng/x" };
    await goes(recordCredentialAction(fd(base)));
    expect(rpc).toHaveBeenLastCalledWith("admin_dx_record_credential", expect.objectContaining({ p_scope_concept_ids: null, p_expires_on: "2027-01-01" }));
    await goes(recordCredentialAction(fd({ ...base, regulator: "iso15189", scope_concept_ids: [C, B] })));
    expect(rpc).toHaveBeenLastCalledWith("admin_dx_record_credential", expect.objectContaining({ p_scope_concept_ids: [C, B] }));
  });
});

describe("verifyLocationAction (map position saved with the check)", () => {
  const check = { listing_id: L, branch_listing_id: B, source: "OpenStreetMap", note: "two sources agree within 50 m" };
  it("with a position, saves it and stamps the check in one call", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await goes(verifyLocationAction(fd({ ...check, latitude: "6.6012", longitude: "3.3512" })))).toBe(`${BASE}/${L}?n=location_verified`);
    expect(rpc).toHaveBeenCalledWith("admin_dx_set_branch_position", expect.objectContaining({ p_branch_listing_id: B, p_latitude: 6.6012, p_longitude: 3.3512 }));
  });
  it("without a position, only stamps (the database refuses a branch with none)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "no position", code: "23514" } });
    expect(await goes(verifyLocationAction(fd({ ...check, latitude: "", longitude: "" })))).toBe(`${BASE}/${L}?n=rule_refused`);
    expect(rpc).toHaveBeenCalledWith("admin_dx_verify_branch_location", expect.objectContaining({ p_branch_listing_id: B }));
  });
  it("refuses half a position before calling the database", async () => {
    expect(await goes(verifyLocationAction(fd({ ...check, latitude: "6.6", longitude: "" })))).toMatch(/n=invalid$/);
    expect(rpc).not.toHaveBeenCalled();
  });
});
