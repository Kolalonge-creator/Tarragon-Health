/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";

const flag = { value: false };
jest.mock("@tarragon/shared", () => {
  const actual = jest.requireActual("@tarragon/shared");
  return {
    ...actual,
    getProposedConfig: (key: string, ...rest: unknown[]) =>
      key === "copilot.previsit_brief_enabled" ? { ...actual.getProposedConfig(key, ...rest), value: flag.value } : actual.getProposedConfig(key, ...rest),
  };
});

const idle = { data: undefined, isLoading: false, isError: false };
const ok = (data: unknown) => ({ data, isLoading: false, isError: false });
const calls = { vitals: [] as string[], tasks: [] as (string | null)[], consults: [] as string[] };
const state = { mental: ok({}) as { data: unknown; isLoading: boolean; isError: boolean } };

jest.mock("@/lib/queries/risk-assessment", () => ({ useRiskScores: () => ok([]) }));
jest.mock("@/lib/queries/mental-health", () => ({ useLatestMentalHealthScreens: () => state.mental }));
jest.mock("@/lib/queries/care-plans", () => ({ useCarePlans: () => ok([{ id: "p1", condition: "hypertension", updated_at: "2026-10-01T00:00:00Z" }]) }));
jest.mock("@/lib/queries/medications", () => ({
  useMedications: () =>
    ok([
      { id: "m1", drug_name: "Amlodipine", refill_date: null, updated_at: "2026-10-01T00:00:00Z", indication: null, care_plan: null },
      { id: "m2", drug_name: "Sertraline", refill_date: null, updated_at: "2026-10-20T00:00:00Z", indication: null, care_plan: null },
    ]),
}));
jest.mock("@/lib/queries/patient-care-gaps", () => ({ usePatientCareGaps: () => ok([{ gap_type: "overdue_screening", condition_or_type: "PHQ-9 follow-up", opened_at: "2026-10-01" }]) }));
jest.mock("@/lib/queries/previsit-vitals", () => ({
  usePreVisitVitals: (id: string) => {
    calls.vitals.push(id);
    return id ? ok({ bloodPressure: [], glucose: [] }) : idle;
  },
}));
jest.mock("@/lib/queries/care-tasks", () => ({
  useCareTasks: (id: string | null) => {
    calls.tasks.push(id);
    return id ? ok([]) : idle;
  },
}));
jest.mock("@/lib/queries/previsit-consultations", () => ({
  usePreVisitConsultations: (id: string) => {
    calls.consults.push(id);
    return id ? ok([]) : idle;
  },
}));

import { PreVisitSummary } from "./pre-visit-summary";

beforeEach(() => {
  flag.value = false;
  calls.vitals = [];
  calls.tasks = [];
  calls.consults = [];
  state.mental = ok({});
});

describe("PreVisitSummary brief flag (S89 review)", () => {
  it("defaults to the existing summary: no brief, and none of the brief's extra audited reads are made", () => {
    render(<PreVisitSummary patientId="pt-1" />);
    expect(screen.queryByTestId("previsit-brief")).toBeNull();
    expect(calls.vitals.every((id) => id === "")).toBe(true);
    expect(calls.tasks.every((id) => id === null)).toBe(true);
    expect(calls.consults.every((id) => id === "")).toBe(true);
    expect(screen.getByText("Pre-visit summary")).toBeTruthy();
  });

  it("when the flag is on, the brief shows and the reads are made for this patient", () => {
    flag.value = true;
    render(<PreVisitSummary patientId="pt-1" />);
    expect(screen.getByTestId("previsit-brief")).toBeTruthy();
    expect(calls.vitals).toContain("pt-1");
  });

  it("a mental-health read that does not error is NOT a sign of access: the brief still withholds mental-health rows", () => {
    flag.value = true;
    state.mental = ok({}); // RLS answers a refused read with empty rows, not an error
    render(<PreVisitSummary patientId="pt-1" />);
    const brief = screen.getByTestId("previsit-brief").textContent ?? "";
    expect(brief).not.toMatch(/sertraline|phq/i);
    expect(brief).toMatch(/1 open care gap|No open care gaps/);
  });

  it("the same holds when the mental-health read errors", () => {
    flag.value = true;
    state.mental = { data: undefined, isLoading: false, isError: true };
    render(<PreVisitSummary patientId="pt-1" />);
    expect(screen.getByTestId("previsit-brief").textContent ?? "").not.toMatch(/sertraline|phq/i);
  });
});
