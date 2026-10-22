import { en } from "@tarragon/i18n";
import * as web from "../../../../web/src/lib/directory/model";
import { EMPTY_FILTERS, hmoKey, isNotOpen, nairaFromKobo, nhiaKey, REPORT_FIELDS, searchArgs, tierKey, TIER_KEY } from "./model";

describe("searchArgs", () => {
  it("sends nothing for an untouched form", () => {
    expect(searchArgs(EMPTY_FILTERS, "2026-10-22T10:00:00Z")).toEqual({ p_limit: 50 });
  });
  it("trims text and sends only what was filled in", () => {
    expect(searchArgs({ ...EMPTY_FILTERS, state: " Lagos ", hmo: "Avon", nhia: true, openNow: true }, "2026-10-22T10:00:00Z")).toEqual({
      p_limit: 50,
      p_state: "Lagos",
      p_hmo: "Avon",
      p_nhia: true,
      p_open_at: "2026-10-22T10:00:00Z",
    });
  });
  it("treats whitespace-only text as empty", () => {
    expect(searchArgs({ ...EMPTY_FILTERS, service: "   ", language: " " }, "x")).toEqual({ p_limit: 50 });
  });
});

describe("labels", () => {
  it("never reads an unknown tier as a stronger one", () => {
    expect(tierKey("made_up")).toBe("directory.tier.seed_only");
    expect(tierKey("licence_checked")).toBe("directory.tier.licence_checked");
  });
  it("shows an HMO or NHIA line only when claimed or confirmed", () => {
    expect(hmoKey(null)).toBeNull();
    expect(hmoKey("confirmed")).toBe("directory.hmo.confirmed");
    expect(nhiaKey("claimed")).toBe("directory.nhia.claimed");
    expect(nhiaKey("unknown")).toBeNull();
  });
  it("formats whole naira from kobo and never invents a price", () => {
    expect(nairaFromKobo(1_000_000)).toBe("₦10,000");
    expect(nairaFromKobo(null)).toBeNull();
    expect(nairaFromKobo(-5)).toBeNull();
    expect(nairaFromKobo(Number.NaN)).toBeNull();
  });
  it("recognises the closed-guard answer", () => {
    expect(isNotOpen({ code: "55000" })).toBe(true);
    expect(isNotOpen({ code: "42501" })).toBe(false);
    expect(isNotOpen(null)).toBe(false);
  });
});

describe("strings the screen uses exist", () => {
  it("has a message for every tier and every report field", () => {
    for (const key of Object.values(TIER_KEY)) expect(en).toHaveProperty([key]);
    for (const f of REPORT_FIELDS) expect(en).toHaveProperty([`directory.report.field.${f}`]);
  });
});

describe("parity with the web model (apps/web/src/lib/directory/model.ts)", () => {
  it("labels, prices and the closed-guard check agree", () => {
    for (const tier of ["seed_only", "phone_confirmed", "licence_checked", "made_up"]) expect(tierKey(tier)).toBe(web.tierKey(tier));
    for (const status of [null, "claimed", "confirmed", "other"]) {
      expect(hmoKey(status)).toBe(web.hmoKey(status));
      expect(nhiaKey(status)).toBe(web.nhiaKey(status));
    }
    for (const kobo of [0, 1_000_000, 123_456, -1, null]) expect(nairaFromKobo(kobo)).toBe(web.nairaFromKobo(kobo));
    for (const e of [{ code: "55000" }, { code: "42501" }, null]) expect(isNotOpen(e)).toBe(web.isNotOpen(e));
  });
  it("sends the same search arguments for the filters both have", () => {
    const f = { state: " Lagos ", service: "lab", language: "", hmo: "Avon", nhia: true, openNow: true };
    expect(searchArgs(f, "2026-10-22T10:00:00Z")).toEqual(web.searchArgs({ ...f, near: null }, "2026-10-22T10:00:00Z"));
    expect(searchArgs(EMPTY_FILTERS, "x")).toEqual(web.searchArgs(web.EMPTY_FILTERS, "x"));
  });
});
