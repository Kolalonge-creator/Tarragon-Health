import { describe, expect, it } from "@jest/globals";
import type { OverviewInputs, QuerySlice } from "./overview-summary";
import { facilityEngagementSchema, governanceSummarySchema, investorSummarySchema } from "./schemas";
import { standoutView } from "./standout";

const loaded = <T>(data: T): QuerySlice<T> => ({ data, isPending: false });
const loading = <T>(): QuerySlice<T> => ({ data: undefined, isPending: true });
const failed = <T>(): QuerySlice<T> => ({ data: undefined, isPending: false });

const ALL_VERIFIED = { staff_total: 10, staff_verified: 10, staff_unverified_active: 0, verification_pct: 100 };

type In = Pick<OverviewInputs, "governance" | "investor" | "facilities">;

function inputs(o: Partial<In> = {}): In {
  return {
    governance: loaded(
      governanceSummarySchema.parse({ clinical: ALL_VERIFIED, risk: { open: 0, by_status: [{ status: "closed", count: 2 }] } })
    ),
    investor: loaded(investorSummarySchema.parse({ mom_growth_pct: 5 })),
    facilities: loaded(facilityEngagementSchema.parse({ total_facilities: 4, facilities_with_usage: 4 })),
    ...o,
  };
}

describe("standoutView", () => {
  it("is clear only when every source was read and none stands out", () => {
    expect(standoutView(inputs())).toEqual({ kind: "clear" });
  });

  it("ranks open risk, then licences, then revenue, then facilities", () => {
    const v = standoutView(
      inputs({
        governance: loaded(
          governanceSummarySchema.parse({
            clinical: { staff_total: 10, staff_verified: 7, staff_unverified_active: 3, verification_pct: 70 },
            risk: { open: 2, by_status: [{ status: "open", count: 2 }] },
          })
        ),
        investor: loaded(investorSummarySchema.parse({ mom_growth_pct: -12 })),
        facilities: loaded(facilityEngagementSchema.parse({ total_facilities: 4, facilities_with_usage: 1 })),
      })
    );
    if (v.kind !== "items") throw new Error("expected items");
    expect([v.top, ...v.rest].map((i) => i.key)).toEqual(["risk", "licences", "revenue", "facilities"]);
    expect(v.top.text).toBe("2 open risk items need review");
    expect(v.incomplete).toBe(false);
  });

  it("uses the singular for one", () => {
    const v = standoutView(
      inputs({ facilities: loaded(facilityEngagementSchema.parse({ total_facilities: 2, facilities_with_usage: 1 })) })
    );
    if (v.kind !== "items") throw new Error("expected items");
    expect(v.top.text).toBe("1 facility has no activity");
  });

  it("does not call flat revenue growth a decline", () => {
    expect(standoutView(inputs({ investor: loaded(investorSummarySchema.parse({ mom_growth_pct: 0 })) }))).toEqual({
      kind: "clear",
    });
  });

  it("is never clear when a source failed", () => {
    expect(standoutView(inputs({ investor: failed() }))).toEqual({ kind: "unknown" });
    expect(standoutView(inputs({ facilities: failed() }))).toEqual({ kind: "unknown" });
  });

  it("treats a refused governance answer ({}) as not answered, not as all fine", () => {
    expect(standoutView(inputs({ governance: loaded(governanceSummarySchema.parse({})) }))).toEqual({ kind: "unknown" });
  });

  it("shows what it found but marks the list incomplete when another source failed", () => {
    const v = standoutView(
      inputs({
        investor: failed(),
        facilities: loaded(facilityEngagementSchema.parse({ total_facilities: 3, facilities_with_usage: 0 })),
      })
    );
    if (v.kind !== "items") throw new Error("expected items");
    expect(v.incomplete).toBe(true);
  });

  it("waits while a source is still loading and nothing has stood out yet", () => {
    expect(standoutView(inputs({ investor: loading() }))).toEqual({ kind: "loading" });
  });

  it("failure outranks loading", () => {
    expect(standoutView(inputs({ investor: loading(), facilities: failed() }))).toEqual({ kind: "unknown" });
  });
});
