/**
 * The corporate dashboard settles each read on its own: a failed read is
 * carried as `unavailable` for that card only, and is never turned into an
 * empty result.
 */
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));
jest.mock("react", () => ({ ...jest.requireActual("react"), cache: <T,>(fn: T) => fn }));

const loaders = {
  analytics: jest.fn(),
  contract: jest.fn(),
  ageBands: jest.fn(),
  medication: jest.fn(),
  engagement: jest.fn(),
  vaccination: jest.fn(),
  funnel: jest.fn(),
  departments: jest.fn(),
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
jest.mock("@/lib/corporate/load-age-band-distribution", () => ({ loadAgeBandDistribution: (...a: unknown[]) => loaders.ageBands(...a) }));
jest.mock("@/lib/outcomes/medication-outcomes", () => ({ loadMedicationOutcomes: (...a: unknown[]) => loaders.medication(...a) }));
jest.mock("@/lib/outcomes/engagement-outcome-correlation", () => ({ loadEngagementOutcomeCorrelation: (...a: unknown[]) => loaders.engagement(...a) }));
jest.mock("@/lib/vaccination/load-coverage-analytics", () => ({ loadVaccinationCoverage: (...a: unknown[]) => loaders.vaccination(...a) }));
jest.mock("@/lib/corporate/load-activation-funnel", () => ({
  loadActivationFunnel: (...a: unknown[]) => loaders.funnel(...a),
  loadDepartmentBreakdown: (...a: unknown[]) => loaders.departments(...a),
}));

import { loadCorporateDashboardData } from "./dashboard-data";

beforeEach(() => {
  loaders.analytics.mockResolvedValue({ cohort_size: 20 });
  loaders.contract.mockResolvedValue(null);
  loaders.ageBands.mockResolvedValue({ "<30": 1, "30-45": 5, "45-60": 9, "60+": 5 });
  loaders.medication.mockResolvedValue({ medsStoppedLast180Days: 2 });
  loaders.engagement.mockResolvedValue([]);
  loaders.vaccination.mockResolvedValue({ eligiblePopulation: 20 });
  loaders.funnel.mockResolvedValue({ eligible: 20, activated: 10, engaged: 4, healthAssessmentPct: 30, preventiveCompletionPct: 10 });
  loaders.departments.mockResolvedValue([{ departmentId: null, departmentName: "No department set", eligible: 20, activated: 10, suppressed: false }]);
});

describe("loadCorporateDashboardData", () => {
  it("is ready with nothing unavailable when every read works", async () => {
    const data = await loadCorporateDashboardData();
    expect(data.state).toBe("ready");
    if (data.state !== "ready") return;
    expect(Object.values(data.unavailable).every((v) => v === false)).toBe(true);
    expect(data.activationFunnel?.activated).toBe(10);
  });

  it.each([
    ["funnel", "activationFunnel"],
    ["departments", "departmentBreakdown"],
    ["vaccination", "vaccinationCoverage"],
    ["ageBands", "ageBands"],
    ["medication", "medicationOutcomes"],
    ["engagement", "engagementOutcomes"],
  ] as const)("a failed %s read is flagged and the rest of the page still loads", async (loader, flag) => {
    loaders[loader].mockRejectedValue(new Error("boom"));
    const data = await loadCorporateDashboardData();
    expect(data.state).toBe("ready");
    if (data.state !== "ready") return;
    expect(data.unavailable[flag]).toBe(true);
    const others = Object.entries(data.unavailable).filter(([k]) => k !== flag);
    expect(others.every(([, v]) => v === false)).toBe(true);
  });

  it("a failed contract read is flagged, an absent contract is not", async () => {
    loaders.contract.mockRejectedValue(new Error("boom"));
    const failedRead = await loadCorporateDashboardData();
    if (failedRead.state !== "ready") throw new Error("expected ready");
    expect(failedRead.unavailable.contract).toBe(true);

    loaders.contract.mockResolvedValue(null);
    const absent = await loadCorporateDashboardData();
    if (absent.state !== "ready") throw new Error("expected ready");
    expect(absent.unavailable.contract).toBe(false);
  });

  it("a failed analytics read lands in no-analytics and still reports a failed contract", async () => {
    loaders.analytics.mockRejectedValue(new Error("boom"));
    loaders.contract.mockRejectedValue(new Error("boom"));
    const data = await loadCorporateDashboardData();
    expect(data.state).toBe("no-analytics");
    if (data.state !== "no-analytics") return;
    expect(data.unavailable.contract).toBe(true);
  });
});
