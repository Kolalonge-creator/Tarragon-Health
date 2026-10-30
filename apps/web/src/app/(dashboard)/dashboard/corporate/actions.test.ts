/**
 * A saved outcome report is frozen and quoted outside the platform. If any of
 * the reads behind it fails, nothing may be saved: a zero put into the snapshot
 * ("0 medicines stopped", "no contract") cannot be corrected afterwards.
 */
jest.mock("server-only", () => ({}));
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));

const insert = jest.fn();
const loaders = {
  analytics: jest.fn(),
  contract: jest.fn(),
  careGaps: jest.fn(),
  medication: jest.fn(),
};

jest.mock("@/lib/auth/current-profile", () => ({
  getCurrentProfile: async () => ({ id: "u-1", role: "hmo_admin", organisation_id: "org-1" }),
}));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => ({ insert: (...a: unknown[]) => insert(...a) }) }),
}));
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
const accessCheck = jest.fn();
jest.mock("@/lib/institutions/aggregate-access", () => ({
  requireInstitutionAggregateAccess: (...a: unknown[]) => accessCheck(...a),
}));
jest.mock("@/lib/corporate/load-cohort-analytics", () => ({ loadCohortAnalytics: (...a: unknown[]) => loaders.analytics(...a) }));
jest.mock("@/lib/outcomes-contracts/get-contract-performance", () => ({ getContractPerformance: (...a: unknown[]) => loaders.contract(...a) }));
jest.mock("@/lib/care-gaps/load-care-gaps", () => ({ loadCareGaps: (...a: unknown[]) => loaders.careGaps(...a) }));
jest.mock("@/lib/outcomes/medication-outcomes", () => ({ loadMedicationOutcomes: (...a: unknown[]) => loaders.medication(...a) }));

import { generateOutcomeReport } from "./actions";

function form() {
  const f = new FormData();
  f.set("organisation_id", "org-1");
  f.set("period_start", "2026-01-01");
  f.set("period_end", "2026-03-31");
  return f;
}

beforeEach(() => {
  accessCheck.mockReset().mockResolvedValue({ client: {}, organisationId: "org-1", minCohortSize: 5 });
  insert.mockReset().mockResolvedValue({ error: null });
  loaders.analytics.mockReset().mockResolvedValue({ cohort_size: 20 });
  loaders.contract.mockReset().mockResolvedValue(null);
  loaders.careGaps.mockReset().mockResolvedValue({ totalOpen: 3, byType: {}, ledger: null });
  loaders.medication.mockReset().mockResolvedValue({ medsStoppedLast180Days: 2 });
});

describe("generateOutcomeReport", () => {
  it("saves the snapshot when every read works", async () => {
    expect(await generateOutcomeReport(undefined, form())).toEqual({ message: "Report generated." });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it.each(["analytics", "contract", "careGaps", "medication"] as const)(
    "saves nothing, and says why, when the %s read fails",
    async (loader) => {
      loaders[loader].mockRejectedValue(new Error("boom"));
      const result = await generateOutcomeReport(undefined, form());
      expect(result?.error).toMatch(/nothing was saved/);
      expect(insert).not.toHaveBeenCalled();
    },
  );

  it("saves nothing, and says why, when the access check itself cannot complete", async () => {
    accessCheck.mockRejectedValue(new Error("cohort size could not be read"));
    const result = await generateOutcomeReport(undefined, form());
    expect(result?.error).toMatch(/nothing was saved/);
    expect(insert).not.toHaveBeenCalled();
  });
});
