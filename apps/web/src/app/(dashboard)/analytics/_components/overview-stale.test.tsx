/** @jest-environment jsdom */
/**
 * The analytics layout steps its own "figures may be out of date" notice aside on the Overview, because the
 * Overview was meant to say so itself. It only did when a figure had no data at all; after a failed refresh the
 * last good figures stayed on screen with no warning. The Overview now says so.
 */
import { render, screen } from "@testing-library/react";

type Result = { data: unknown; isPending: boolean; isError: boolean };
const hooks: Record<string, Result> = {};
const ok = (data: unknown): Result => ({ data, isPending: false, isError: false });
const stale = (data: unknown): Result => ({ data, isPending: false, isError: true });

jest.mock("next/link", () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
jest.mock("@/lib/analytics/queries", () => ({
  useBusinessSummary: () => hooks.business,
  useFinancialSummary: () => hooks.financial,
  useInvestorSummary: () => hooks.investor,
  useGovernanceSummary: () => hooks.governance,
  useFacilityEngagement: () => hooks.facilities,
  useClinicalOutcomes: () => hooks.outcomes,
}));

import { OverviewDashboard } from "./overview-dashboard";
import {
  businessSummarySchema, clinicalOutcomesSchema, facilityEngagementSchema,
  financialSummarySchema, governanceSummarySchema, investorSummarySchema,
} from "@/lib/analytics/schemas";

beforeEach(() => {
  hooks.business = ok(businessSummarySchema.parse({ total_patients: 31, active_patients: 20 }));
  hooks.financial = ok(financialSummarySchema.parse({}));
  hooks.investor = ok(investorSummarySchema.parse({}));
  hooks.governance = ok(governanceSummarySchema.parse({ clinical: { staff_total: 10, staff_verified: 10, staff_unverified_active: 0, verification_pct: 100 } }));
  hooks.facilities = ok(facilityEngagementSchema.parse({ total_facilities: 4, facilities_with_usage: 4 }));
  hooks.outcomes = ok(clinicalOutcomesSchema.parse({}));
});

const notice = () => screen.queryByRole("status");

describe("Overview after a failed refresh", () => {
  it("shows no notice when every read is current", () => {
    render(<OverviewDashboard firstName="Ada" />);
    expect(notice()).toBeNull();
  });

  it("keeps the last good figure and says it may be out of date", () => {
    hooks.business = stale(businessSummarySchema.parse({ total_patients: 31, active_patients: 20 }));
    render(<OverviewDashboard firstName="Ada" />);
    expect(screen.getByText("31")).toBeTruthy();
    expect(notice()?.textContent).toContain("Total patients may be out of date: the last refresh failed");
  });

  it("says nothing extra for a figure that never loaded: its own card already says so", () => {
    hooks.business = { data: undefined, isPending: false, isError: true };
    render(<OverviewDashboard firstName="Ada" />);
    expect(notice()).toBeNull();
    expect(screen.getByText("Could not be loaded", { selector: "*" })).toBeTruthy();
  });
});
