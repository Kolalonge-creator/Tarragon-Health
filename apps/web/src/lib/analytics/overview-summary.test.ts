import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@jest/globals";
import { formatPercent } from "./format";
import {
  buildOverviewSummary,
  type OverviewInputs,
  type QuerySlice,
} from "./overview-summary";
import {
  businessSummarySchema,
  clinicalOutcomesSchema,
  facilityEngagementSchema,
  financialSummarySchema,
  governanceSummarySchema,
  investorSummarySchema,
} from "./schemas";

/**
 * The analytics Overview is the first screen the CEO sees. These pin the two
 * ways it used to mislead:
 *
 *  - a figure that was not known (loading, failed, or refused) was shown as a
 *    real zero, most seriously "No open risk items" with a green arrow on the
 *    compliance tile whenever the risk figures simply were not there;
 *  - revenue growth was described as "MRR", a number this pay-per-service
 *    platform does not have, and the "Compliance score" tile was only the
 *    clinician licence-verification rate.
 *
 * Fixtures are parsed through the real Zod schemas so they carry exactly the
 * shapes the RPCs return, including the `{}` a non-analyst receives.
 */

const loaded = <T>(data: T): QuerySlice<T> => ({ data, isPending: false });
const loading = <T>(): QuerySlice<T> => ({ data: undefined, isPending: true });
const failed = <T>(): QuerySlice<T> => ({ data: undefined, isPending: false });

function inputs(overrides: Partial<OverviewInputs> = {}): OverviewInputs {
  return {
    business: loaded(businessSummarySchema.parse({ total_patients: 31, active_patients: 31 })),
    financial: loaded(financialSummarySchema.parse({})),
    investor: loaded(investorSummarySchema.parse({})),
    governance: loaded(governanceSummarySchema.parse({})),
    facilities: loaded(facilityEngagementSchema.parse({})),
    outcomes: loaded(clinicalOutcomesSchema.parse({})),
    ...overrides,
  };
}

function governance(clinical: Record<string, number>, risk: Record<string, unknown> = {}) {
  return loaded(governanceSummarySchema.parse({ clinical, risk }));
}

const CLINICIANS_ALL_VERIFIED = {
  staff_total: 10,
  staff_verified: 10,
  staff_unverified_active: 0,
  verification_pct: 100,
};

describe("revenue growth wording", () => {
  it("calls it revenue, never MRR, whichever way it moved", () => {
    const up = buildOverviewSummary(
      inputs({ investor: loaded(investorSummarySchema.parse({ mom_growth_pct: 12.5 })) })
    ).banner;
    const down = buildOverviewSummary(
      inputs({ investor: loaded(investorSummarySchema.parse({ mom_growth_pct: -4 })) })
    ).banner;

    expect(up).toContain("Revenue is up 12.5% month over month");
    expect(down).toContain("Revenue is down 4% month over month");
    expect(up).not.toMatch(/MRR/);
    expect(down).not.toMatch(/MRR/);
  });

  it("says nothing about growth when there is none to report", () => {
    expect(buildOverviewSummary(inputs()).banner).not.toMatch(/month over month/);
  });
});

describe("a figure that is not known never renders as zero", () => {
  it.each([
    ["still loading", loading, "Loading"],
    ["failed", failed, "Could not load"],
  ])("every tile shows a hint, not a number, when its query is %s", (_name, slice, hint) => {
    const { tiles } = buildOverviewSummary({
      business: slice(),
      financial: slice(),
      investor: slice(),
      governance: slice(),
      facilities: slice(),
      outcomes: slice(),
    });

    for (const tile of Object.values(tiles)) {
      expect(tile.empty).toEqual({ hint });
      expect(tile.value).toBeUndefined();
      expect(tile.delta).toBeUndefined();
    }
  });

  it("treats the empty answer a non-analyst gets as not answered, not as zero risk", () => {
    // The RPC returns {} and the schema fills it with zeros. Before this, that
    // read as 0% verified with "No open risk items" and a green arrow.
    const { tiles, banner } = buildOverviewSummary(inputs({ governance: loaded(governanceSummarySchema.parse({})) }));

    expect(tiles.verification.empty).toEqual({ hint: "Could not load" });
    expect(banner).toContain("Governance figures could not be loaded.");
    expect(banner).not.toMatch(/No risks have been logged|open risk|No open risk/);
  });

  it("keeps a real answer visible when a later refresh fails", () => {
    const stale: QuerySlice<ReturnType<typeof governanceSummarySchema.parse>> = {
      data: governanceSummarySchema.parse({ clinical: CLINICIANS_ALL_VERIFIED }),
      isPending: false,
    };
    const { tiles } = buildOverviewSummary(inputs({ governance: stale }));
    expect(tiles.verification.value).toBe(formatPercent(100));
  });

  it("does not claim a governance failure while the query is merely slow", () => {
    const { banner } = buildOverviewSummary(inputs({ governance: loading() }));
    expect(banner).not.toMatch(/could not be loaded/);
  });

  it("still shows a genuine zero as zero", () => {
    // Guards the other direction: the fix must not turn real zeros into hints.
    const { tiles } = buildOverviewSummary(
      inputs({
        facilities: loaded(facilityEngagementSchema.parse({ total_facilities: 9, facilities_with_usage: 0 })),
        financial: loaded(financialSummarySchema.parse({ revenue_by_currency: [] })),
      })
    );

    expect(tiles.facilities.value).toBe("0%");
    expect(tiles.facilities.delta?.text).toBe("0 of 9 with activity");
    expect(tiles.revenue.value).toBe("₦0");
  });
});

describe("clinician licence verification tile", () => {
  it("shows a hint, not 0%, when no clinicians are on file", () => {
    const { tiles } = buildOverviewSummary(inputs({ governance: governance({ staff_total: 0, verification_pct: 0 }) }));
    expect(tiles.verification.empty).toEqual({ hint: "No clinicians on file" });
  });

  it("reports the rate with the count behind it", () => {
    const { tiles } = buildOverviewSummary(
      inputs({
        governance: governance({
          staff_total: 10,
          staff_verified: 8,
          staff_unverified_active: 2,
          verification_pct: 80,
        }),
      })
    );
    expect(tiles.verification.value).toBe(formatPercent(80));
    expect(tiles.verification.delta).toEqual({ text: "8 of 10 licences verified", direction: "down" });
  });

  it("marks a fully verified team as good", () => {
    const { tiles } = buildOverviewSummary(inputs({ governance: governance(CLINICIANS_ALL_VERIFIED) }));
    expect(tiles.verification.delta?.direction).toBe("up");
  });
});

describe("risk register sentence", () => {
  const banner = (risk: Record<string, unknown>) =>
    buildOverviewSummary(inputs({ governance: governance(CLINICIANS_ALL_VERIFIED, risk) })).banner;

  it("says an empty register is empty, not that nothing is wrong", () => {
    expect(banner({ open: 0, by_status: [] })).toContain("No risks have been logged in the risk register yet.");
  });

  it("stays quiet when every logged risk has been closed", () => {
    const text = banner({ open: 0, by_status: [{ status: "closed", count: 3 }] });
    expect(text).not.toMatch(/risk/);
  });

  it("counts open items, singular and plural", () => {
    expect(banner({ open: 1, by_status: [{ status: "open", count: 1 }] })).toContain(
      "1 open risk item still needs review."
    );
    expect(
      banner({ open: 2, by_status: [{ status: "open", count: 2 }, { status: "closed", count: 1 }] })
    ).toContain("2 open risk items still need review.");
  });
});

describe("facilities and blood pressure tiles", () => {
  it("says there is nothing yet rather than showing 0%", () => {
    const { tiles } = buildOverviewSummary(inputs());
    expect(tiles.facilities.empty).toEqual({ hint: "No facilities yet" });
    expect(tiles.bpControl.empty).toEqual({ hint: "No readings yet" });
  });

  it("reports the share and the count behind it", () => {
    const { tiles } = buildOverviewSummary(
      inputs({
        facilities: loaded(facilityEngagementSchema.parse({ total_facilities: 4, facilities_with_usage: 1 })),
        outcomes: loaded(clinicalOutcomesSchema.parse({ bp_control: { total: 4, controlled: 3, pct: 75 } })),
      })
    );
    expect(tiles.facilities.value).toBe("25%");
    expect(tiles.bpControl.value).toBe("75%");
    expect(tiles.bpControl.delta?.text).toBe("3 of 4 controlled");
  });
});

describe("Overview component", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/(dashboard)/analytics/_components/overview-dashboard.tsx"),
    "utf8"
  );

  it("keeps the labels honest", () => {
    expect(source).not.toMatch(/MRR/);
    expect(source).not.toMatch(/Compliance score/);
    expect(source).not.toMatch(/Avg facility utilisation/);
  });

  it("does not fold an unknown figure back into zero", () => {
    // The shape that caused the original bug: `data?.x ?? 0`. The derivation
    // lives in lib/analytics/overview-summary.ts, where unknown stays unknown.
    expect(source).not.toMatch(/\?\?\s*0\b/);
  });
});
