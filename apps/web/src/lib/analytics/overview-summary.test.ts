import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@jest/globals";
import { formatPercent } from "./format";
import {
  buildOverviewSummary,
  TILE_LABELS,
  type OverviewInputs,
} from "./overview-summary";
import type { QuerySlice } from "@/lib/queries/query-slice";
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

const loaded = <T>(data: T): QuerySlice<T> => ({ data, isLoading: false, isError: false });
const loading = <T>(): QuerySlice<T> => ({ data: undefined, isLoading: true, isError: false });
const failed = <T>(): QuerySlice<T> => ({ data: undefined, isLoading: false, isError: true });
/** A refresh failed after a good read: the last good data is still there. */
const stale = <T>(data: T): QuerySlice<T> => ({ data, isLoading: false, isError: true });

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
    ["still loading", loading, "Loading…"],
    ["failed", failed, "Could not be loaded"],
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

    expect(tiles.verification.empty).toEqual({ hint: "Could not be loaded" });
    expect(banner).toContain("Governance figures could not be loaded.");
    expect(banner).not.toMatch(/No risks have been logged|open risk|No open risk/);
  });

  it("keeps a real answer visible when a later refresh fails", () => {
    const { tiles } = buildOverviewSummary(
      inputs({ governance: stale(governanceSummarySchema.parse({ clinical: CLINICIANS_ALL_VERIFIED })) })
    );
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

describe("revenue growth tile", () => {
  const tile = (mom: number) =>
    buildOverviewSummary(inputs({ investor: loaded(investorSummarySchema.parse({ mom_growth_pct: mom })) })).tiles
      .revenue12m;

  it("writes the sign out, so direction is not carried by colour alone", () => {
    expect(tile(12.5).delta).toEqual({ text: "+12.5% MoM", direction: "up" });
    expect(tile(-100).delta).toEqual({ text: "-100% MoM", direction: "down" });
  });

  it("shows 0 as neutral, not growth", () => {
    // The RPC returns 0 when the prior 30 days had no revenue to compare with,
    // so a green up arrow on 0 would read as healthy growth.
    expect(tile(0).delta).toEqual({ text: "0% MoM", direction: "flat" });
  });
});

describe("patients and revenue tiles", () => {
  it("shows the count with how many are active", () => {
    const { tiles } = buildOverviewSummary(inputs());
    expect(tiles.patients.value).toBe("31");
    expect(tiles.patients.delta?.text).toBe("31 active");
  });

  it("uses a currency's own symbol rather than calling it naira", () => {
    const { tiles } = buildOverviewSummary(
      inputs({
        financial: loaded(
          financialSummarySchema.parse({ revenue_by_currency: [{ currency: "GBP", total_minor: 250000 }] })
        ),
      })
    );
    expect(tiles.revenue.value).toBe("£2,500");
  });

  it("prefers naira when it is on file", () => {
    const { tiles } = buildOverviewSummary(
      inputs({
        financial: loaded(
          financialSummarySchema.parse({
            revenue_by_currency: [
              { currency: "GBP", total_minor: 250000 },
              { currency: "NGN", total_minor: 1000000 },
            ],
          })
        ),
      })
    );
    expect(tiles.revenue.value).toBe("₦10,000");
  });
});

describe("banner when there is nothing to report yet", () => {
  const quiet = governance({ staff_total: 0 }, { open: 0, by_status: [{ status: "closed", count: 1 }] });

  it("says loading only while something is still loading", () => {
    const { banner } = buildOverviewSummary(inputs({ business: loading(), investor: loading(), governance: quiet }));
    expect(banner).toBe("Your latest figures are loading.");
  });

  it("does not say loading once everything has settled and failed", () => {
    const { banner } = buildOverviewSummary(inputs({ business: failed(), investor: failed(), governance: quiet }));
    expect(banner).toBe("Some figures could not be loaded.");
    expect(banner).not.toMatch(/loading/);
  });
});

describe("verification tile colour", () => {
  it("is green only when every licence on file is verified", () => {
    // 8 of 10 verified with nobody ACTIVE unverified (the other two are
    // inactive). The percentage still counts them, so it must not look clean.
    const { tiles } = buildOverviewSummary(
      inputs({
        governance: governance({
          staff_total: 10,
          staff_verified: 8,
          staff_unverified_active: 0,
          verification_pct: 80,
        }),
      })
    );
    expect(tiles.verification.delta).toEqual({ text: "8 of 10 licences verified", direction: "down" });
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

describe("figures kept after a failed refresh are marked out of date", () => {
  it("says nothing when every read is current", () => {
    expect(buildOverviewSummary(inputs()).staleNotice).toBeNull();
  });

  it("says nothing for a figure that never loaded: its tile already says so", () => {
    const { staleNotice, tiles } = buildOverviewSummary(inputs({ business: failed(), financial: loading() }));
    expect(staleNotice).toBeNull();
    expect(tiles.patients.empty).toEqual({ hint: "Could not be loaded" });
  });

  it("names the cards whose figures are the last good ones, and only those", () => {
    const { staleNotice, tiles } = buildOverviewSummary(
      inputs({
        business: stale(businessSummarySchema.parse({ total_patients: 31, active_patients: 31 })),
        outcomes: stale(clinicalOutcomesSchema.parse({})),
      })
    );
    expect(staleNotice).toContain(TILE_LABELS.patients);
    expect(staleNotice).toContain(TILE_LABELS.bpControl);
    expect(staleNotice).not.toContain(TILE_LABELS.revenue);
    expect(staleNotice).toMatch(/may be out of date: the last refresh failed/);
    // The last good figure is still shown, not blanked.
    expect(tiles.patients.value).toBe("31");
  });

  it.each([
    ["financial", TILE_LABELS.revenue],
    ["business", TILE_LABELS.patients],
    ["investor", TILE_LABELS.revenue12m],
    ["facilities", TILE_LABELS.facilities],
    ["outcomes", TILE_LABELS.bpControl],
  ] as const)("a stale %s read is reported against %s", (key, label) => {
    const base = inputs();
    const { staleNotice } = buildOverviewSummary({ ...base, [key]: stale(base[key].data) } as OverviewInputs);
    expect(staleNotice).toContain(label);
  });

  it("a stale governance read is reported against the licences card", () => {
    const { staleNotice } = buildOverviewSummary(
      inputs({ governance: stale(governanceSummarySchema.parse({ clinical: CLINICIANS_ALL_VERIFIED })) })
    );
    expect(staleNotice).toContain(TILE_LABELS.verification);
  });
});
