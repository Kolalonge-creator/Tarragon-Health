import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { isPossiblyMinor, loadPatientContext } from "./context";
import { chainable, fakeSupabaseFrom } from "./test-support";

const FIXED_NOW = new Date("2026-08-29T12:00:00.000Z");

describe("isPossiblyMinor", () => {
  it("returns null when no date of birth is on file, rather than guessing", () => {
    expect(isPossiblyMinor(null, FIXED_NOW)).toBeNull();
  });

  it("returns false for a clearly-adult date of birth", () => {
    expect(isPossiblyMinor("1990-01-01", FIXED_NOW)).toBe(false);
  });

  it("returns true for a clearly-minor date of birth", () => {
    expect(isPossiblyMinor("2015-01-01", FIXED_NOW)).toBe(true);
  });

  it("treats someone who turns 18 later this year as still a minor", () => {
    // Born 2008-12-01: turns 18 on 2026-12-01, after FIXED_NOW (2026-08-29).
    expect(isPossiblyMinor("2008-12-01", FIXED_NOW)).toBe(true);
  });

  it("treats someone whose 18th birthday already passed this year as an adult", () => {
    // Born 2008-01-01: turned 18 on 2026-01-01, before FIXED_NOW.
    expect(isPossiblyMinor("2008-01-01", FIXED_NOW)).toBe(false);
  });

  it("treats today as the birthday itself as already turned 18 (>=, not >)", () => {
    expect(isPossiblyMinor("2008-08-29", FIXED_NOW)).toBe(false);
  });
});

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
      patient_pregnancy: { data: null, error: null },
    });

    const context = await loadPatientContext(supabase, "patient-1");

    expect(context.demographics).toEqual({ ageYears: 10, sex: "female" });
    // A 10-year-old's date of birth should also trip the §78.17
    // paediatric safety-layer signal.
    expect(context.possibleMinor).toBe(true);
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
      patient_pregnancy: { data: null, error: null },
    });

    const context = await loadPatientContext(supabase, "patient-1");

    expect(context.demographics).toEqual({ ageYears: null, sex: null });
    expect(context.possibleMinor).toBeNull();
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
      patient_pregnancy: { data: null, error: null },
    });

    const context = await loadPatientContext(supabase, "patient-1");

    expect(context.recentVitals).toEqual([
      { vitalType: "blood_pressure", value: "130/85", unit: "mmHg", takenAt: "2026-08-20T00:00:00Z" },
    ]);
  });

  it("splits elevated risk tiers into elevatedConditions and the high/very_high-only highRiskConditions", async () => {
    const supabase = fakeSupabase({
      prevention_risk_scores: {
        data: [
          { condition: "hypertension", tier: "moderate" },
          { condition: "diabetes", tier: "high" },
          { condition: "obesity", tier: "very_high" },
        ],
        error: null,
      },
      profiles: { data: { date_of_birth: null, sex: null }, error: null },
      patient_conditions: { data: [], error: null },
      medications: { data: [], error: null },
      patient_allergies: { data: [], error: null },
      vitals_readings: { data: [], error: null },
      lab_analyte_readings: { data: [], error: null },
      appointments: { data: [], error: null },
      patient_pregnancy: { data: null, error: null },
    });

    const context = await loadPatientContext(supabase, "patient-1");

    expect(context.elevatedConditions).toEqual(["hypertension", "diabetes", "obesity"]);
    expect(context.highRiskConditions).toEqual(["diabetes", "obesity"]);
  });

  it("surfaces isPregnant from patient_pregnancy, defaulting false when no row exists", async () => {
    const pregnant = fakeSupabase({
      prevention_risk_scores: { data: [], error: null },
      profiles: { data: { date_of_birth: null, sex: null }, error: null },
      patient_conditions: { data: [], error: null },
      medications: { data: [], error: null },
      patient_allergies: { data: [], error: null },
      vitals_readings: { data: [], error: null },
      lab_analyte_readings: { data: [], error: null },
      appointments: { data: [], error: null },
      patient_pregnancy: { data: { is_pregnant: true }, error: null },
    });
    expect((await loadPatientContext(pregnant, "patient-1")).isPregnant).toBe(true);

    const noRow = fakeSupabase({
      prevention_risk_scores: { data: [], error: null },
      profiles: { data: { date_of_birth: null, sex: null }, error: null },
      patient_conditions: { data: [], error: null },
      medications: { data: [], error: null },
      patient_allergies: { data: [], error: null },
      vitals_readings: { data: [], error: null },
      lab_analyte_readings: { data: [], error: null },
      appointments: { data: [], error: null },
      patient_pregnancy: { data: null, error: null },
    });
    expect((await loadPatientContext(noRow, "patient-1")).isPregnant).toBe(false);
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
    expect(context.elevatedConditions).toEqual([]);
    expect(context.highRiskConditions).toEqual([]);
    expect(context.isPregnant).toBe(false);
    expect(context.possibleMinor).toBeNull();
  });
});
