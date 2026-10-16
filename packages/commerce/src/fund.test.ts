import { describe, expect, it } from "@jest/globals";
import { fundErrorKey, parseDonations, parseFundReport, parseFundSupport } from "../../../supabase/functions/_shared/commerce/fund.ts";

type Open = Extract<ReturnType<typeof parseFundReport>, { open: true }>;
type GrantsOpen = Extract<Open["grants"], { withheld: false }>;
function grantsOf(r: ReturnType<typeof parseFundReport>): GrantsOpen {
  if (!r.open || r.grants.withheld) throw new Error("expected shown grants");
  return r.grants as GrantsOpen;
}

describe("parseFundReport", () => {
  it("a closed or unreadable report shows no figures at all", () => {
    expect(parseFundReport(null)).toEqual({ open: false, criteria: [] });
    expect(parseFundReport({ open: false, criteria: ["a"] })).toEqual({ open: false, criteria: ["a"] });
    expect(parseFundReport({ open: true, min_cell: 1 })).toEqual({ open: false, criteria: [] });
  });
  it("shows figures that clear the minimum and withholds the rest", () => {
    const r = parseFundReport({ open: true, min_cell: 20, criteria: ["c"], donations: { count: 25, total_kobo: 5_000_000 }, grants: { count: 22, total_kobo: 3_000_000, by_kind: [{ kind: "membership", count: 22, total_kobo: 3_000_000 }] } });
    expect(r.open && r.donations).toEqual({ withheld: false, count: 25, totalKobo: 5_000_000 });
    expect(r.open && r.grants).toEqual({ withheld: false, totalsWithheld: false, count: 22, totalKobo: 3_000_000, cells: [{ kind: "membership", count: 22, totalKobo: 3_000_000 }] });
  });
  it("never shows a cell below the minimum even if the server sent one (defence in depth)", () => {
    const r = parseFundReport({ open: true, min_cell: 20, criteria: [], donations: { count: 3, total_kobo: 1 }, grants: { count: 40, total_kobo: 9, by_kind: [{ kind: "membership", count: 30, total_kobo: 5 }, { kind: "lab_panel", count: 2, total_kobo: 4 }] } });
    expect(r.open && r.donations).toEqual({ withheld: true });
    expect(grantsOf(r).cells.map((c) => c.kind)).toEqual(["membership"]);
  });
  it("when the server withheld the totals, none are shown", () => {
    const r = parseFundReport({ open: true, min_cell: 20, criteria: [], donations: { withheld: true }, grants: { totals_withheld: true, by_kind: [] } });
    const g = grantsOf(r);
    expect([g.totalsWithheld, g.count, g.totalKobo]).toEqual([true, null, null]);
  });
  it("a withheld grants block stays withheld", () => {
    const r = parseFundReport({ open: true, min_cell: 20, criteria: [], donations: { withheld: true }, grants: { withheld: true } });
    expect(r.open && r.grants).toEqual({ withheld: true });
  });
});

describe("donations and support", () => {
  it("parses a donor's own gifts, dropping broken rows", () => {
    const rows = parseDonations([{ id: "d1", reference: "CAF-ABCD1234", amount_kobo: 500_000, state: "pledged", item_name_key: null, created_at: "a", pledge_expires_at: "b" }, { id: "d2", amount_kobo: -1 }]);
    expect(rows.map((r) => r.reference)).toEqual(["CAF-ABCD1234"]);
  });
  it("a donor's rows carry no pool, no grant and no balance field", () => {
    const [row] = parseDonations([{ id: "d1", reference: "CAF-ABCD1234", amount_kobo: 500_000, state: "received", item_name_key: null, created_at: "a", pledge_expires_at: "b", pool_kobo: 99 }]);
    expect(Object.keys(row!).sort()).toEqual(["amountKobo", "createdAt", "id", "itemNameKey", "pledgeExpiresAt", "reference", "state"]);
  });
  it("a person's support shows item, status and end date and nothing else", () => {
    const [s] = parseFundSupport([{ item_code: "membership_annual", item_name_key: "k", status: "approved", expires_at: "t", criterion: "secret", ceiling_kobo: 9 }]);
    expect(Object.keys(s!).sort()).toEqual(["expiresAt", "itemCode", "itemNameKey", "status"]);
  });
  it("maps errors to keys", () => {
    expect(fundErrorKey("access_fund_not_open")).toBe("fund.error.not_open");
    expect(fundErrorKey("boom")).toBe("fund.error.unknown");
  });
});
