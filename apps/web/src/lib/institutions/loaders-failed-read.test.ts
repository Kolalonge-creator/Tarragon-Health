/**
 * Every loader behind the HMO and corporate dashboards must throw when a
 * database read fails, never return the zeros or empty lists a missing read
 * would otherwise compute. Each case has a control where every read succeeds,
 * so the "throws" cases cannot pass just because the loader always throws.
 */
jest.mock("server-only", () => ({}));
jest.mock("@/lib/ml/governed-ml-client", () => ({
  createGovernedMlClient: () => ({ analyseCohort: async () => ({ cohort_size: 12 }) }),
}));

import { fakeSupabase, fails, ok } from "./fake-supabase";
import { loadCohortAnalytics } from "@/lib/corporate/load-cohort-analytics";
import { loadActivationFunnel, loadDepartmentBreakdown } from "@/lib/corporate/load-activation-funnel";
import { loadAgeBandDistribution } from "@/lib/corporate/load-age-band-distribution";
import { loadVaccinationCoverage } from "@/lib/vaccination/load-coverage-analytics";
import { loadCareGaps } from "@/lib/care-gaps/load-care-gaps";
import { getContractPerformance } from "@/lib/outcomes-contracts/get-contract-performance";
import { loadMedicationOutcomes } from "@/lib/outcomes/medication-outcomes";
import { loadEngagementOutcomeCorrelation } from "@/lib/outcomes/engagement-outcome-correlation";

const ORG = "org-1";
const MIN = 5;
const patients = Array.from({ length: 12 }, (_, i) => ({
  id: `p${i}`,
  sex: i % 2 ? "female" : "male",
  date_of_birth: "1980-01-01",
  state: "Lagos",
}));
const rosterRows = patients.map((p) => ({
  id: `r-${p.id}`,
  status: "claimed",
  claimed_profile_id: p.id,
  eligible_from: null,
  eligible_until: null,
  department_id: null,
}));

describe("cohort analytics", () => {
  const good = { profiles: ok(patients) };
  it("reads fine when every read succeeds", async () => {
    await expect(loadCohortAnalytics(fakeSupabase(good), ORG, MIN)).resolves.toEqual({ cohort_size: 12 });
  });
  it.each(["profiles", "patient_risk_scores", "care_plans", "screening_schedules", "screening_results"])(
    "throws when the %s read fails",
    async (table) => {
      await expect(loadCohortAnalytics(fakeSupabase({ ...good, [table]: fails() }), ORG, MIN)).rejects.toBeDefined();
    },
  );
});

describe("activation funnel", () => {
  const good = {
    employer_roster_members: ok(rosterRows),
    vitals_readings: ok([{ patient_id: "p1" }]),
    screening_results: ok([]),
    prevention_risk_scores: ok([{ profile_id: "p1" }]),
    screening_completions: ok([]),
  };
  it("counts real activity when every read succeeds", async () => {
    const funnel = await loadActivationFunnel(fakeSupabase(good), ORG, MIN);
    expect(funnel).toMatchObject({ eligible: 12, activated: 12, engaged: 1, healthAssessmentPct: 8 });
  });
  it.each(["employer_roster_members", "vitals_readings", "screening_results", "prevention_risk_scores", "screening_completions"])(
    "throws when the %s read fails, never a 0% figure",
    async (table) => {
      await expect(loadActivationFunnel(fakeSupabase({ ...good, [table]: fails() }), ORG, MIN)).rejects.toBeDefined();
    },
  );
});

describe("department breakdown", () => {
  const good = { employer_roster_members: ok(rosterRows), employer_departments: ok([]) };
  it("returns rows when every read succeeds", async () => {
    expect(await loadDepartmentBreakdown(fakeSupabase(good), ORG, MIN)).toHaveLength(1);
  });
  it.each(["employer_roster_members", "employer_departments"])("throws when the %s read fails", async (table) => {
    await expect(loadDepartmentBreakdown(fakeSupabase({ ...good, [table]: fails() }), ORG, MIN)).rejects.toBeDefined();
  });
});

describe("age bands", () => {
  it("bands real ages", async () => {
    const d = await loadAgeBandDistribution(fakeSupabase({ profiles: ok(patients) }), ORG);
    expect(d?.["45-60"]).toBeGreaterThanOrEqual(0);
  });
  it("throws when the read fails", async () => {
    await expect(loadAgeBandDistribution(fakeSupabase({ profiles: fails() }), ORG)).rejects.toBeDefined();
  });
});

describe("vaccination coverage", () => {
  const good = {
    profiles: ok(patients),
    vaccination_catalog: ok([{ id: "v1", name: "Hep B" }]),
    vaccination_records: ok(patients.slice(0, 6).map((p) => ({ profile_id: p.id, vaccination_catalog_id: "v1" }))),
    vaccination_schedules: ok([]),
  };
  it("reports real uptake when every read succeeds", async () => {
    const c = await loadVaccinationCoverage(fakeSupabase(good), ORG, MIN);
    expect(c).toMatchObject({ eligiblePopulation: 12, vaccinatedCount: 6, uptakePercent: 50 });
  });
  it.each(["profiles", "vaccination_catalog", "vaccination_records", "vaccination_schedules"])(
    "throws when the %s read fails, never 0% uptake",
    async (table) => {
      await expect(loadVaccinationCoverage(fakeSupabase({ ...good, [table]: fails() }), ORG, MIN)).rejects.toBeDefined();
    },
  );
});

describe("care gaps", () => {
  const good = {
    profiles: ok(patients),
    patient_care_gaps: ok([{ gap_type: "overdue_screening", patient_id: "p1", opened_at: "2026-01-01" }]),
  };
  it("counts real gaps when every read succeeds", async () => {
    const s = await loadCareGaps(fakeSupabase(good), ORG, MIN);
    expect(s?.totalOpen).toBe(1);
  });
  it.each(["profiles", "patient_care_gaps"])("throws when the %s read fails, not an empty panel", async (table) => {
    await expect(loadCareGaps(fakeSupabase({ ...good, [table]: fails() }), ORG, MIN)).rejects.toBeDefined();
  });
});

describe("contract performance", () => {
  const good = {
    outcomes_contracts: ok({
      contract_type: "flat",
      outcome_thresholds: [],
      payout_terms: null,
      effective_from: "2026-01-01",
    }),
    profiles: ok(patients),
  };
  it("returns the contract when every read succeeds", async () => {
    expect(await getContractPerformance(fakeSupabase(good), ORG)).toMatchObject({ contractType: "flat" });
  });
  it("returns null only for a genuinely missing contract", async () => {
    expect(await getContractPerformance(fakeSupabase({ ...good, outcomes_contracts: ok(null) }), ORG)).toBeNull();
  });
  it.each(["outcomes_contracts", "profiles"])("throws when the %s read fails, not 'no contract'", async (table) => {
    await expect(getContractPerformance(fakeSupabase({ ...good, [table]: fails() }), ORG)).rejects.toBeDefined();
  });
});

describe("medication outcomes", () => {
  const good = { medications: ok([{ id: "m1", patient_id: "p1" }]), patient_risk_scores: ok([]) };
  it("counts real stops when every read succeeds", async () => {
    expect((await loadMedicationOutcomes(fakeSupabase(good), ORG)).medsStoppedLast180Days).toBe(1);
  });
  it.each(["medications", "patient_risk_scores"])("throws when the %s read fails, never 0 stops", async (table) => {
    await expect(loadMedicationOutcomes(fakeSupabase({ ...good, [table]: fails() }), ORG)).rejects.toBeDefined();
  });
});

describe("engagement outcomes", () => {
  const good = {
    patient_engagement_scores: ok([{ patient_id: "p1", tier: "highly_engaged", computed_at: "2026-01-01" }]),
    patient_risk_scores: ok([{ patient_id: "p1", risk_level: "low", computed_at: "2026-01-01" }]),
  };
  it("buckets real patients when every read succeeds", async () => {
    expect(await loadEngagementOutcomeCorrelation(fakeSupabase(good), ORG, MIN)).toHaveLength(1);
  });
  it.each(["patient_engagement_scores", "patient_risk_scores"])("throws when the %s read fails", async (table) => {
    await expect(loadEngagementOutcomeCorrelation(fakeSupabase({ ...good, [table]: fails() }), ORG, MIN)).rejects.toBeDefined();
  });
});
