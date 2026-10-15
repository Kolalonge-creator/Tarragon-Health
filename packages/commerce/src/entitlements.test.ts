import { describe, expect, it } from "@jest/globals";
import { entitlementLines, entitlementSource, parseEntitlements } from "../../../supabase/functions/_shared/commerce/entitlements.ts";

const base = { id: "e1", kind: "consultation_credit", state: "active", name_key: "catalog.x.name", ends_at: null, remaining_uses: null, days_left: null, source: "paid", sponsor_name: null, part_covered: false };

describe("parseEntitlements", () => {
  it("reads a well-formed row and drops a broken one", () => {
    const rows = parseEntitlements([base, { id: 3 }, null, { ...base, id: "e2", state: "weird" }]);
    expect(rows.map((r) => r.id)).toEqual(["e1"]);
  });
  it("anything that is not a list is an empty list, never a wrong claim", () => {
    expect(parseEntitlements(null)).toEqual([]);
    expect(parseEntitlements({})).toEqual([]);
  });
  it("an unknown source is shown as paid, and a sponsor name is kept only for a sponsor source (never for the Fund)", () => {
    expect(parseEntitlements([{ ...base, source: "mystery" }])[0]!.source).toBe("paid");
    expect(parseEntitlements([{ ...base, source: "access_fund", sponsor_name: "Secret Name" }])[0]!.sponsorName).toBeNull();
    expect(parseEntitlements([{ ...base, source: "sponsor", sponsor_name: "Acme Ltd" }])[0]!.sponsorName).toBe("Acme Ltd");
  });
  it("a negative or fractional count is not believed", () => {
    const r = parseEntitlements([{ ...base, remaining_uses: -1, days_left: 1.5 }])[0]!;
    expect([r.remainingUses, r.daysLeft]).toEqual([null, null]);
  });
});

describe("entitlementLines (19.12 wording)", () => {
  const view = (o: Record<string, unknown>) => parseEntitlements([{ ...base, ...o }])[0]!;
  it("says '3 consultations remaining' with the plural key and the count", () => {
    expect(entitlementLines(view({ remaining_uses: 3 }))).toEqual([{ key: "entitlement.remaining.consultation_other", params: { count: 3 } }]);
  });
  it("uses the singular for exactly one", () => {
    expect(entitlementLines(view({ remaining_uses: 1 }))[0]!.key).toBe("entitlement.remaining.consultation_one");
  });
  it("says 'valid for 60 more days' and the singular and today", () => {
    expect(entitlementLines(view({ kind: "lab_panel", days_left: 60 }))).toEqual([{ key: "entitlement.valid_days_other", params: { count: 60 } }]);
    expect(entitlementLines(view({ kind: "lab_panel", days_left: 1 }))[0]!.key).toBe("entitlement.valid_days_one");
    expect(entitlementLines(view({ kind: "lab_panel", days_left: 0 }))[0]!.key).toBe("entitlement.valid_today");
  });
  it("gives count then days when both exist, and a kind without its own noun uses the general wording", () => {
    expect(entitlementLines(view({ kind: "membership", remaining_uses: 2, days_left: 10 })).map((l) => l.key)).toEqual(["entitlement.remaining_uses_plural", "entitlement.valid_days_other"]);
  });
  it("an entitlement that is not active says only its state", () => {
    expect(entitlementLines(view({ state: "expired", remaining_uses: 3, days_left: 5 }))).toEqual([{ key: "entitlement.state.expired", params: {} }]);
  });
});

describe("entitlementSource", () => {
  const view = (o: Record<string, unknown>) => parseEntitlements([{ ...base, ...o }])[0]!;
  it("names where it came from in plain words", () => {
    expect(entitlementSource(view({ source: "paid" })).key).toBe("entitlement.source.paid");
    expect(entitlementSource(view({ source: "supporter" })).key).toBe("entitlement.source.supporter");
    expect(entitlementSource(view({ source: "sponsor", sponsor_name: "Acme Ltd" }))).toEqual({ key: "entitlement.source.sponsor", params: { name: "Acme Ltd" } });
    expect(entitlementSource(view({ source: "sponsor" })).key).toBe("entitlement.source.sponsor_generic");
  });
  it("the Fund is named but never described beyond its name", () => {
    expect(entitlementSource(view({ source: "access_fund" }))).toEqual({ key: "entitlement.source.access_fund", params: {} });
  });
});
