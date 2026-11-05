const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { diagnosticSearchConfig, searchDiagnosticServices } from "./search";

const C = "33333333-3333-4333-8333-333333333333";
const row = {
  service_id: "11111111-1111-4111-8111-111111111111",
  branch_listing_id: "22222222-2222-4222-8222-222222222222",
  kind: "lab", provider_name: "Lab", branch_name: "VI", address: "1 Road", neighbourhood: null, town: "VI", lga: "Eti-Osa",
  state: "Lagos", phone: "+2348000000001", latitude: 6.43, longitude: 3.42, distance_km: 1.2, availability: "available",
  appointment_required: false, preparation_note: null, performed_elsewhere: false, result_group: "eligible",
  last_confirmed_at: null, credentials_on_file: null, total_count: 7,
};

beforeEach(() => rpc.mockReset());

describe("searchDiagnosticServices", () => {
  it("passes radius and page size from versioned config", async () => {
    rpc.mockResolvedValue({ data: [row], error: null });
    const cfg = diagnosticSearchConfig();
    const res = await searchDiagnosticServices({ conceptId: C, location: { lat: 6.43, lng: 3.42 }, page: 2 });
    expect(rpc).toHaveBeenCalledWith("search_diagnostic_services", expect.objectContaining({
      p_concept_id: C, p_radius_km: cfg.default_radius_km, p_limit: cfg.page_size, p_offset: 2 * cfg.page_size, p_state: null,
    }));
    expect(res).toEqual(expect.objectContaining({ ok: true, total: 7 }));
  });

  it("an unconfigured radius falls back to the default instead of widening the search", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await searchDiagnosticServices({ conceptId: C, location: { lat: 6.43, lng: 3.42, radiusKm: 900 } });
    expect(rpc).toHaveBeenCalledWith("search_diagnostic_services", expect.objectContaining({ p_radius_km: diagnosticSearchConfig().default_radius_km }));
  });

  it("a state search sends no point and no radius", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const res = await searchDiagnosticServices({ conceptId: C, location: { state: "FCT", lga: "AMAC" } });
    expect(rpc).toHaveBeenCalledWith("search_diagnostic_services", expect.objectContaining({ p_lat: null, p_lng: null, p_radius_km: null, p_state: "FCT", p_lga: "AMAC" }));
    expect(res).toEqual(expect.objectContaining({ ok: true, total: 0, radiusKm: null }));
  });

  it("leaves unconfirmed branches out unless asked, and a page past the end has an unknown total, not 0", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const res = await searchDiagnosticServices({ conceptId: C, location: { state: "Lagos" }, page: 3 });
    expect(rpc).toHaveBeenCalledWith("search_diagnostic_services", expect.objectContaining({ p_include_unconfirmed: false }));
    expect(res).toEqual(expect.objectContaining({ ok: true, total: null }));
  });

  it("refuses bad input before calling the database", async () => {
    expect(await searchDiagnosticServices({ conceptId: "nope", location: { state: "Lagos" } })).toEqual({ ok: false, reason: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a database error is a failure, never an empty list", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "55000" } });
    expect(await searchDiagnosticServices({ conceptId: C, location: { state: "Lagos" } })).toEqual({ ok: false, reason: "closed" });
    rpc.mockResolvedValue({ data: [{ ...row, result_group: "partner" }], error: null });
    expect(await searchDiagnosticServices({ conceptId: C, location: { state: "Lagos" } })).toEqual({ ok: false, reason: "failed" });
  });
});
