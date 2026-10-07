import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { buildPrepDraft, buildPrepQuestions, prepareForAppointment } from "./composed-surfaces";
import type { PatientContext } from "./context";
import { chainable } from "./test-support";

const CONTEXT = {
  demographics: { ageYears: 50, sex: "female" },
  activeConditions: [{ conditionName: "Hypertension", status: "active" }],
  activeMedications: [],
  allergies: [],
  recentVitals: [{ vitalType: "blood_pressure", value: "130/85", unit: "mmHg", takenAt: "2026-08-10T00:00:00Z" }],
  recentLabResults: [],
  upcomingAppointments: [{ scheduledFor: "2026-08-20T09:00:00Z", status: "scheduled", reason: "Follow-up" }],
  lifestyleProgrammes: [],
  elevatedConditions: [],
  highRiskConditions: [],
  isPregnant: false,
  possibleMinor: false,
} as unknown as PatientContext;

function fakeSupabase(byTable: Record<string, unknown>): SupabaseClient<Database> {
  return {
    from: jest.fn((table: string) => chainable(byTable[table] ?? { data: [], error: null, count: 0 })),
  } as unknown as SupabaseClient<Database>;
}

describe("pre-consultation summary (7.7)", () => {
  const now = new Date("2026-08-15T00:00:00Z");

  it("reports what changed since the last completed appointment", async () => {
    const supabase = fakeSupabase({
      appointments: { data: [{ scheduled_for: "2026-07-01T09:00:00Z" }], error: null },
      medications: { data: [{ drug_name: "Amlodipine", refill_date: null }], error: null },
      vitals_readings: { data: null, error: null, count: 9 },
      symptoms: { data: [{ description: "dizzy in the mornings", severity: 4, reported_at: "2026-08-10T00:00:00Z" }], error: null, count: 2 },
    });
    const out = await prepareForAppointment(supabase, "p1", CONTEXT, now);
    expect(out.changesSinceLastReview.lastReviewAt).toBe("2026-07-01T09:00:00Z");
    expect(out.changesSinceLastReview.readingsLogged).toBe(9);
    expect(out.changesSinceLastReview.symptomsLogged).toBe(2);
    expect(out.changesSinceLastReview.newMedicines).toEqual(["Amlodipine"]);
  });

  it("says there is no earlier visit when none is on file, and still builds questions", async () => {
    const out = await prepareForAppointment(fakeSupabase({}), "p1", CONTEXT, now);
    expect(out.changesSinceLastReview.lastReviewAt).toBeNull();
    expect(out.questions.length).toBeGreaterThan(0);
  });

  it("builds every question from a fact in the record, and always ends with the standing question", () => {
    const q = buildPrepQuestions(
      {
        recentSymptoms: [{ description: "a cough", severity: 3, reportedAt: "x" }],
        medicationIssues: [{ drugName: "Metformin", issue: "Refill was due 2026-08-01" }],
        recentMeasurements: [{ vitalType: "blood_pressure", value: "130/85", unit: "mmHg", takenAt: "x" }],
        changesSinceLastReview: { lastReviewAt: null, newMedicines: [], readingsLogged: 0, symptomsLogged: 0 },
      },
      { activeConditions: [{ conditionName: "Hypertension", status: "active" }] }
    );
    expect(q.some((x) => x.includes("a cough"))).toBe(true);
    expect(q.some((x) => x.includes("Metformin"))).toBe(true);
    expect(q.some((x) => x.includes("Hypertension"))).toBe(true);
    expect(q[q.length - 1]).toMatch(/differently/);
    expect(q.length).toBeLessThanOrEqual(8);
  });

  it("the draft is plain text for the patient to edit, with no dose, no diagnosis and no em dash", () => {
    const draft = buildPrepDraft({
      nextAppointment: null,
      recentSymptoms: [{ description: "a cough", severity: null, reportedAt: "x" }],
      recentMeasurements: [],
      medicationIssues: [{ drugName: "Metformin", issue: "Refill was due 2026-08-01" }],
      changesSinceLastReview: { lastReviewAt: "2026-07-01T09:00:00Z", newMedicines: [], readingsLogged: 3, symptomsLogged: 1 },
      questions: ["Is there anything I should be doing differently, or checking more often?"],
    });
    expect(draft).toContain("Since my last review on 2026-07-01");
    expect(draft).toContain("Metformin");
    expect(draft).not.toMatch(/—/);
    expect(draft).not.toMatch(/\b\d+\s?mg\b/i);
  });
});
