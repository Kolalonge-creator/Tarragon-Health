import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { loadPatientContext } from "./context";
import { chainable, fakeSupabaseFrom } from "./test-support";

jest.mock("@/lib/lifestyle/service", () => ({
  CONDITION_LABEL: { hypertension: "Blood pressure" },
  getLifestyleState: jest.fn(async () => []),
}));

function fakeSupabase(resultsByTable: Record<string, unknown>): SupabaseClient<Database> {
  return { from: fakeSupabaseFrom(resultsByTable) } as unknown as SupabaseClient<Database>;
}

describe("loadPatientContext", () => {
  it("computes age from date_of_birth and carries sex through", async () => {
    const tenYearsAgo = new Date();
    tenYearsAgo.setUTCFullYear(tenYearsAgo.getUTCFullYear() - 10);
    const dob = tenYearsAgo.toISOString().slice(0, 10);

    const supabase = fakeSupabase({
      prevention_risk_scores: { data: [], error: null },
      profiles: { data: { date_of_birth: dob, sex: "female" }, error: null },
      patient_conditions: { data: [], error: null },
      medications: { data: [], error: null },
      patient_allergies: { data: [], error: null },
      vitals_readings: { data: [], error: null },
      lab_analyte_readings: { data: [], error: null },
      appointments: { data: [], error: null },
    });

    const context = await loadPatientContext(supabase, "patient-1");

    expect(context.demographics).toEqual({ ageYears: 10, sex: "female" });
  });

  it("returns null age when date_of_birth is null, without throwing", async () => {
    const supabase = fakeSupabase({
      prevention_risk_scores: { data: [], error: null },
      profiles: { data: { date_of_birth: null, sex: null }, error: null },
      patient_conditions: { data: [], error: null },
      medications: { data: [], error: null },
      patient_allergies: { data: [], error: null },
      vitals_readings: { data: [], error: null },
      lab_analyte_readings: { data: [], error: null },
      appointments: { data: [], error: null },
    });

    const context = await loadPatientContext(supabase, "patient-1");

    expect(context.demographics).toEqual({ ageYears: null, sex: null });
  });

  it("deduplicates recentVitals to the latest row per vital_type", async () => {
    const supabase = fakeSupabase({
      prevention_risk_scores: { data: [], error: null },
      profiles: { data: { date_of_birth: null, sex: null }, error: null },
      patient_conditions: { data: [], error: null },
      medications: { data: [], error: null },
      patient_allergies: { data: [], error: null },
      vitals_readings: {
        data: [
          {
            vital_type: "blood_pressure",
            systolic: 130,
            diastolic: 85,
            pulse_bpm: null,
            glucose_mmol_l: null,
            weight_kg: null,
            spo2_pct: null,
            temperature_c: null,
            taken_at: "2026-08-20T00:00:00Z",
          },
          {
            vital_type: "blood_pressure",
            systolic: 150,
            diastolic: 95,
            pulse_bpm: null,
            glucose_mmol_l: null,
            weight_kg: null,
            spo2_pct: null,
            temperature_c: null,
            taken_at: "2026-08-10T00:00:00Z",
          },
        ],
        error: null,
      },
      lab_analyte_readings: { data: [], error: null },
      appointments: { data: [], error: null },
    });

    const context = await loadPatientContext(supabase, "patient-1");

    expect(context.recentVitals).toEqual([
      { vitalType: "blood_pressure", value: "130/85", unit: "mmHg", takenAt: "2026-08-20T00:00:00Z" },
    ]);
  });

  it("never throws when every read rejects or errors", async () => {
    const supabase = {
      from: jest.fn(() => chainable({ data: null, error: { message: "connection reset" } })),
    } as unknown as SupabaseClient<Database>;

    const context = await loadPatientContext(supabase, "patient-1");

    expect(context.demographics).toEqual({ ageYears: null, sex: null });
    expect(context.activeConditions).toEqual([]);
    expect(context.activeMedications).toEqual([]);
    expect(context.allergies).toEqual([]);
    expect(context.recentVitals).toEqual([]);
    expect(context.recentLabResults).toEqual([]);
    expect(context.upcomingAppointments).toEqual([]);
    expect(context.lifestyleProgrammes).toEqual([]);
  });
});
