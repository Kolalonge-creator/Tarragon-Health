const rpc = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { findPlacesAction, openSuggestedPlaceAction, suggestPlaceAction, withdrawPlaceAction } from "./orders";

const O = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";
const B = "33333333-3333-4333-8333-333333333333";
const C = "44444444-4444-4444-8444-444444444444";
const place = {
  suggestion_id: O, kind: "lab", test: "HbA1c", provider_name: "Lab", branch_name: "Ikeja", address: "1 Road", town: "Ikeja",
  lga: "Ikeja", state: "Lagos", phone: "+2348000000001", latitude: 6.6, longitude: 3.35, appointment_required: false,
  preparation_note: null, still_recommendable: true, is_partner: false, suggested_at: "2026-11-05T09:00:00Z",
  suggested_by: "Dr A", viewed_at: null,
};

beforeEach(() => rpc.mockReset());

describe("openSuggestedPlaceAction", () => {
  it("returns the place, or none, and a failure is never 'no place'", async () => {
    rpc.mockResolvedValue({ data: place, error: null });
    expect(await openSuggestedPlaceAction({ kind: "lab", orderId: O })).toEqual({ ok: true, place });
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await openSuggestedPlaceAction({ kind: "lab", orderId: O })).toEqual({ ok: true, place: null });
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect(await openSuggestedPlaceAction({ kind: "lab", orderId: O })).toEqual({ ok: false });
    expect(await openSuggestedPlaceAction({ kind: "x", orderId: O })).toEqual({ ok: false });
  });
});

describe("findPlacesAction", () => {
  it("searches the patient's state, eligible branches only", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await findPlacesAction({ patientId: P, conceptId: C, state: "Lagos", lga: "" });
    expect(rpc).toHaveBeenCalledWith("search_diagnostic_services", expect.objectContaining({
      p_concept_id: C, p_state: "Lagos", p_lga: null, p_lat: null, p_include_unconfirmed: false,
    }));
  });
});

describe("suggestPlaceAction", () => {
  it("maps a branch that is no longer recommendable to its own reason", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23514" } });
    expect(await suggestPlaceAction({ kind: "lab", orderId: O, patientId: P, branchListingId: B, conceptId: C }))
      .toEqual({ ok: false, reason: "not_recommendable" });
  });
  it("passes the order, branch and test", async () => {
    rpc.mockResolvedValue({ data: O, error: null });
    expect(await suggestPlaceAction({ kind: "imaging", orderId: O, patientId: P, branchListingId: B, conceptId: C })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("clinician_suggest_place", { p_kind: "imaging", p_order_id: O, p_branch_listing_id: B, p_concept_id: C });
  });
});

describe("withdrawPlaceAction", () => {
  it("needs a reason", async () => {
    expect(await withdrawPlaceAction({ suggestionId: O, patientId: P, reason: "no" })).toEqual({ ok: false, reason: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
