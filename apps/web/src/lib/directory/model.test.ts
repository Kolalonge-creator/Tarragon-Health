import { describe, expect, it } from "@jest/globals";
import { en } from "@tarragon/i18n";
import { EMPTY_FILTERS, bookingStateKey, hmoKey, isNotOpen, nairaFromKobo, nhiaKey, ratingStatusKey, searchArgs, tierKey } from "./model";

describe("directory model", () => {
  it("an unknown tier reads as the weakest, never stronger", () => {
    expect(tierKey("licence_checked")).toBe("directory.tier.licence_checked");
    expect(tierKey("platinum")).toBe("directory.tier.seed_only");
  });
  it("a claim is worded as a claim and a confirmation as a confirmation", () => {
    expect(en[hmoKey("claimed")!]).toMatch(/not confirmed/i);
    expect(en[hmoKey("confirmed")!]).toMatch(/confirmed from/i);
    expect(hmoKey(null)).toBeNull();
    expect(en[nhiaKey("claimed")!]).toMatch(/not yet confirmed/i);
    expect(nhiaKey("x")).toBeNull();
  });
  it("shows a price only where there is one, from integer kobo", () => {
    expect(nairaFromKobo(1500000)).toContain("15,000");
    expect(nairaFromKobo(null)).toBeNull();
    expect(nairaFromKobo(-1)).toBeNull();
    expect(nairaFromKobo(Number.NaN)).toBeNull();
  });
  it("sends only the filters that were filled in", () => {
    expect(searchArgs(EMPTY_FILTERS, "2026-10-12T09:00:00Z")).toEqual({ p_limit: 50 });
    expect(searchArgs({ ...EMPTY_FILTERS, state: " Lagos ", nhia: true, openNow: true, near: { lat: 6.5, lng: 3.4 } }, "2026-10-12T09:00:00Z")).toEqual({
      p_limit: 50, p_state: "Lagos", p_nhia: true, p_open_at: "2026-10-12T09:00:00Z", p_lat: 6.5, p_lng: 3.4,
    });
  });
  it("maps statuses to copy that exists", () => {
    for (const s of ["pending", "published", "rejected"]) expect(en[ratingStatusKey(s)!]).toBeTruthy();
    expect(ratingStatusKey("x")).toBeNull();
    for (const s of ["requested", "confirmed", "cancelled", "completed", "missed", "odd"]) expect(en[bookingStateKey(s)]).toBeTruthy();
  });
  it("treats 55000 as 'not open yet'", () => {
    expect(isNotOpen({ code: "55000" })).toBe(true);
    expect(isNotOpen({ code: "42501" })).toBe(false);
    expect(isNotOpen(null)).toBe(false);
  });
});
