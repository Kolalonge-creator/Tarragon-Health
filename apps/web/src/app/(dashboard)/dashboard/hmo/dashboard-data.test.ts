/**
 * The HMO dashboard settles each read on its own: a failed read is carried as
 * `unavailable` for that card only, and is never turned into an empty result.
 */
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));
jest.mock("react", () => ({ ...jest.requireActual("react"), cache: <T,>(fn: T) => fn }));

const loaders = {
  analytics: jest.fn(),
  contract: jest.fn(),
  careGaps: jest.fn(),
  medication: jest.fn(),
  engagement: jest.fn(),
  vaccination: jest.fn(),
};
jest.mock("@/lib/auth/current-profile", () => ({
  getCurrentProfile: async () => ({ full_name: "Ada", organisation_id: "org-1" }),
}));
jest.mock("@/lib/institutions/aggregate-access", () => ({
  requireInstitutionAggregateAccess: async () => ({
    client: {},
    organisationId: "org-1",
    minCohortSize: 5,
    cohortSize: 20,
    suppressed: false,
  }),
}));
jest.mock("@/lib/corporate/load-cohort-analytics", () => ({ loadCohortAnalytics: (...a: unknown[]) => loaders.analytics(...a) }));
jest.mock("@/lib/outcomes-contracts/get-contract-performance", () => ({ getContractPerformance: (...a: unknown[]) => loaders.contract(...a) }));
jest.mock("@/lib/care-gaps/load-care-gaps", () => ({ loadCareGaps: (...a: unknown[]) => loaders.careGaps(...a) }));
jest.mock("@/lib/outcomes/medication-outcomes", () => ({ loadMedicationOutcomes: (...a: unknown[]) => loaders.medication(...a) }));
jest.mock("@/lib/outcomes/engagement-outcome-correlation", () => ({ loadEngagementOutcomeCorrelation: (...a: unknown[]) => loaders.engagement(...a) }));
jest.mock("@/lib/vaccination/load-coverage-analytics", () => ({ loadVaccinationCoverage: (...a: unknown[]) => loaders.vaccination(...a) }));

import { loadHmoDashboardData } from "./dashboard-data";

const good = { cohort_size: 20 };

beforeEach(() => {
  loaders.analytics.mockResolvedValue(good);
  loaders.contract.mockResolvedValue({ contractType: "flat", effectiveFrom: "2026-01-01", payoutTerms: null, thresholds: [] });
  loaders.careGaps.mockResolvedValue({ totalOpen: 3, byType: {}, cohortSize: 20, ledger: null });
  loaders.medication.mockResolvedValue({ medsStoppedLast180Days: 2 });
  loaders.engagement.mockResolvedValue([]);
  loaders.vaccination.mockResolvedValue({ eligiblePopulation: 20 });
});

describe("loadHmoDashboardData", () => {
  it("is ready with nothing unavailable when every read works", async () => {
    const data = await loadHmoDashboardData();
    expect(data.state).toBe("ready");
    if (data.state !== "ready") return;
    expect(Object.values(data.unavailable).every((v) => v === false)).toBe(true);
    expect(data.careGaps?.totalOpen).toBe(3);
  });

  it("marks only the failed card unavailable and keeps the rest", async () => {
    loaders.careGaps.mockRejectedValue(new Error("boom"));
    const data = await loadHmoDashboardData();
    expect(data.state).toBe("ready");
    if (data.state !== "ready") return;
    expect(data.unavailable.careGaps).toBe(true);
    expect(data.careGaps).toBeNull();
    expect(data.unavailable.contract).toBe(false);
    expect(data.contractPerformance).not.toBeNull();
    expect(data.vaccinationCoverage).not.toBeNull();
  });

  it.each([
    ["contract", "contract"],
    ["medication", "medicationOutcomes"],
    ["engagement", "engagementOutcomes"],
    ["vaccination", "vaccinationCoverage"],
  ] as const)("a failed %s read is flagged, not hidden", async (loader, flag) => {
    loaders[loader].mockRejectedValue(new Error("boom"));
    const data = await loadHmoDashboardData();
    if (data.state !== "ready") throw new Error("expected ready");
    expect(data.unavailable[flag]).toBe(true);
  });

  it("a genuinely empty read (null) is not flagged as unavailable", async () => {
    loaders.contract.mockResolvedValue(null);
    const data = await loadHmoDashboardData();
    if (data.state !== "ready") throw new Error("expected ready");
    expect(data.contractPerformance).toBeNull();
    expect(data.unavailable.contract).toBe(false);
  });

  it("a failed analytics read lands in no-analytics, still carrying the other flags", async () => {
    loaders.analytics.mockRejectedValue(new Error("boom"));
    loaders.vaccination.mockRejectedValue(new Error("boom"));
    const data = await loadHmoDashboardData();
    expect(data.state).toBe("no-analytics");
    if (data.state !== "no-analytics") return;
    expect(data.unavailable.vaccinationCoverage).toBe(true);
    expect(data.unavailable.contract).toBe(false);
  });
});
