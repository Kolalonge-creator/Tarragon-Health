/**
 * The phone's diagnostic directory reads (Phases 5 and 6). What matters, as on web: a failed or malformed read is a failure,
 * never "nothing found"; a closed directory says so; the search sends the configured page size and partner band and never
 * a location the phone does not have; past the last page the total is unknown, not 0.
 */
import { supabase } from "./supabase";
import { findPlaces, findTests, loadBranchProfile, openSuggestedPlace } from "./diagnostic-directory";

jest.mock("./supabase", () => ({ supabase: { rpc: jest.fn(), auth: { getSession: jest.fn() } } }));
jest.mock("./api", () => ({ API_BASE_URL: "https://app.example" }));

const rpc = supabase.rpc as unknown as jest.Mock;
const ok = (data: unknown) => Promise.resolve({ data, error: null });
const fail = (code: string) => Promise.resolve({ data: null, error: { code } });

const place = {
  suggestion_id: "s1", kind: "lab", test: "HbA1c", provider_name: "Lab Co", branch_name: "Ikeja", address: "1 Road", town: "Ikeja",
  lga: null, state: "Lagos", phone: "+2348000000000", latitude: 6.6, longitude: 3.3, appointment_required: null, preparation_note: null,
  still_recommendable: true, is_partner: false, suggested_at: "2026-11-05T10:00:00Z", suggested_by: null, viewed_at: null,
};
const row = {
  service_id: "sv1", branch_listing_id: "b1", kind: "lab", provider_name: "Lab Co", branch_name: "Ikeja", address: "1 Road",
  neighbourhood: null, town: "Ikeja", lga: "Ikeja", state: "Lagos", phone: "+2348000000000", latitude: 6.6, longitude: 3.3,
  distance_km: null, availability: "by_appointment", appointment_required: false, preparation_note: null, performed_elsewhere: false,
  result_group: "eligible", is_partner: false, last_confirmed_at: null, credentials_on_file: null, total_count: 3,
};

beforeEach(() => rpc.mockReset());

describe("openSuggestedPlace", () => {
  it("returns the place, and no place as null rather than an error", async () => {
    rpc.mockReturnValueOnce(ok(place));
    const r = await openSuggestedPlace("lab", "o1");
    expect(rpc).toHaveBeenCalledWith("order_suggested_place", { p_kind: "lab", p_order_id: "o1" });
    expect(r.ok && r.data?.providerName).toBe("Lab Co");
    rpc.mockReturnValueOnce(ok(null));
    expect(await openSuggestedPlace("imaging", "o2")).toEqual({ ok: true, data: null });
  });
  it("treats a malformed payload as a failure", async () => {
    rpc.mockReturnValueOnce(ok({ ...place, still_recommendable: "yes" }));
    expect(await openSuggestedPlace("lab", "o1")).toEqual({ ok: false, reason: "failed" });
  });
  it("reports a refused read as denied", async () => {
    rpc.mockReturnValueOnce(fail("42501"));
    expect(await openSuggestedPlace("lab", "o1")).toEqual({ ok: false, reason: "denied" });
  });
});

describe("findTests", () => {
  it("never calls the database for one letter", async () => {
    expect(await findTests("a")).toEqual({ ok: false, reason: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("surfaces the clarifying group", async () => {
    rpc.mockReturnValueOnce(ok([{ concept_id: "c1", display: "Abdominal ultrasound", patient_description: null, matched_on: "clarify", clarifies_display: "Scan" }]));
    const r = await findTests("scan");
    expect(r.ok && r.data.clarifying).toBe("Scan");
  });
});

describe("findPlaces", () => {
  it("searches by state and LGA with the configured page size and partner band, and no point", async () => {
    rpc.mockReturnValueOnce(ok([row]));
    const r = await findPlaces({ conceptId: "c1", state: "Lagos", lga: "Ikeja" });
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("search_diagnostic_services");
    expect(args).toMatchObject({ p_state: "Lagos", p_lga: "Ikeja", p_lat: null, p_lng: null, p_radius_km: null, p_include_unconfirmed: true, p_offset: 0 });
    expect(typeof args.p_limit).toBe("number");
    expect(typeof args.p_partner_band_km).toBe("number");
    expect(r.ok && r.data.total).toBe(3);
    expect(r.ok && r.data.rows[0].byAppointment).toBe(true);
  });
  it("drops a one-letter LGA rather than sending it", async () => {
    rpc.mockReturnValueOnce(ok([]));
    await findPlaces({ conceptId: "c1", state: "Lagos", lga: "I" });
    expect(rpc.mock.calls[0][1].p_lga).toBeNull();
  });
  it("says the directory is closed, and never turns an error into an empty list", async () => {
    rpc.mockReturnValueOnce(fail("55000"));
    expect(await findPlaces({ conceptId: "c1", state: "Lagos" })).toEqual({ ok: false, reason: "closed" });
    rpc.mockReturnValueOnce(fail("XX000"));
    expect(await findPlaces({ conceptId: "c1", state: "Lagos" })).toEqual({ ok: false, reason: "failed" });
  });
  it("past the end the total is unknown, not 0", async () => {
    rpc.mockReturnValueOnce(ok([]));
    const r = await findPlaces({ conceptId: "c1", state: "Lagos", page: 2 });
    expect(r).toEqual({ ok: true, data: { rows: [], total: null } });
  });
  it("rejects an unknown result group", async () => {
    rpc.mockReturnValueOnce(ok([{ ...row, result_group: "sponsored" }]));
    expect(await findPlaces({ conceptId: "c1", state: "Lagos" })).toEqual({ ok: false, reason: "failed" });
  });
});

describe("loadBranchProfile", () => {
  it("maps the services and rejects a malformed service", async () => {
    const profile = {
      branch_listing_id: "b1", kind: "lab", provider_name: "Lab Co", branch_name: "Ikeja", address: "1 Road", neighbourhood: null,
      town: null, lga: null, state: "Lagos", phone: null, email: null, website: null, latitude: null, longitude: null,
      location_checked_on: null, is_partner: false,
      services: [{ concept_id: "c1", test: "HbA1c", availability: "available", appointment_required: false, preparation_note: null, performed_elsewhere: false }],
    };
    rpc.mockReturnValueOnce(ok(profile));
    const r = await loadBranchProfile("b1");
    expect(r.ok && r.data?.services[0].test).toBe("HbA1c");
    rpc.mockReturnValueOnce(ok({ ...profile, services: [{ test: "HbA1c" }] }));
    expect(await loadBranchProfile("b1")).toEqual({ ok: false, reason: "failed" });
  });
});
