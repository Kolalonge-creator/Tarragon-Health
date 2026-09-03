import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { careTasksThisMonth, explainHealthRecord, prepareForAppointment } from "./composed-surfaces";
import type { PatientContext } from "./context";
import { chainable } from "./test-support";

const EMPTY_CONTEXT: PatientContext = {
  demographics: { ageYears: null, sex: null },
  elevatedConditions: [],
  highRiskConditions: [],
  isPregnant: false,
  possibleMinor: null,
  lifestyleProgrammes: [],
  activeConditions: [],
  activeMedications: [],
  allergies: [],
  recentVitals: [],
  recentLabResults: [],
  upcomingAppointments: [],
};

function fakeSupabase(resultsByTable: Record<string, unknown>): SupabaseClient<Database> {
  return {
    from: jest.fn((table: string) => chainable(resultsByTable[table] ?? { data: [], error: null })),
  } as unknown as SupabaseClient<Database>;
}

describe("explainHealthRecord", () => {
  it("maps every documented field straight from the context, with no generated text", () => {
    const context: PatientContext = {
      ...EMPTY_CONTEXT,
      activeConditions: [{ conditionName: "Hypertension", status: "active" }],
      recentLabResults: [{ code: "HBA1C", value: 7.8, unit: "%", takenAt: "2026-08-01T00:00:00Z" }],
      activeMedications: [{ drugName: "Amlodipine", dose: "5mg", frequency: "daily" }],
      upcomingAppointments: [{ scheduledFor: "2026-09-10T09:00:00Z", status: "scheduled", reason: "Follow-up" }],
      lifestyleProgrammes: [
        {
          condition: "hypertension",
          conditionLabel: "Blood pressure",
          programmeName: "BP programme",
          currentPhaseName: "Foundation",
          status: "active",
          goalTitles: ["Daily walk"],
          hasOpenRedFlag: false,
        },
      ],
    };

    const result = explainHealthRecord(context);

    expect(result).toEqual({
      currentConditions: [{ conditionName: "Hypertension", status: "active" }],
      recentResults: [{ code: "HBA1C", value: 7.8, unit: "%", takenAt: "2026-08-01T00:00:00Z" }],
      currentMedicines: [{ drugName: "Amlodipine", dose: "5mg", frequency: "daily" }],
      upcomingAppointments: [{ scheduledFor: "2026-09-10T09:00:00Z", reason: "Follow-up" }],
      activeCareGoals: [{ conditionLabel: "Blood pressure", goalTitles: ["Daily walk"] }],
    });
  });

  it("returns empty arrays, never throws, for a patient with nothing on file", () => {
    expect(explainHealthRecord(EMPTY_CONTEXT)).toEqual({
      currentConditions: [],
      recentResults: [],
      currentMedicines: [],
      upcomingAppointments: [],
      activeCareGoals: [],
    });
  });
});

describe("careTasksThisMonth", () => {
  const now = new Date("2026-08-15T00:00:00Z");

  it("includes only items due within the current month, sorted by due date", async () => {
    const supabase = fakeSupabase({
      vitals_reminder_state: { data: { next_due_at: "2026-08-20" }, error: null },
      medications: { data: [{ drug_name: "Metformin", refill_date: "2026-09-05" }], error: null },
      screening_schedules: {
        data: [{ due_date: "2026-08-05", status: "pending", screen_types: { name: "Cervical screening" } }],
        error: null,
      },
    });
    const context: PatientContext = {
      ...EMPTY_CONTEXT,
      upcomingAppointments: [{ scheduledFor: "2026-08-25T10:00:00Z", status: "scheduled", reason: "Review" }],
    };

    const result = await careTasksThisMonth(supabase, "patient-1", context, now);

    expect(result.monthLabel).toBe("August 2026");
    expect(result.items.map((i) => i.category)).toEqual(["screening", "monitoring", "appointment"]);
    expect(result.items[0]).toEqual({
      category: "screening",
      label: "Cervical screening",
      done: false,
      dueOn: "2026-08-05",
    });
  });

  it("excludes items due in a different month", async () => {
    const supabase = fakeSupabase({
      vitals_reminder_state: { data: { next_due_at: "2026-09-01" }, error: null },
      medications: { data: [{ drug_name: "Metformin", refill_date: "2026-07-01" }], error: null },
      screening_schedules: { data: [], error: null },
    });

    const result = await careTasksThisMonth(supabase, "patient-1", EMPTY_CONTEXT, now);

    expect(result.items).toEqual([]);
  });

  it("never throws when every extra read errors", async () => {
    const supabase = {
      from: jest.fn(() => chainable({ data: null, error: { message: "boom" } })),
    } as unknown as SupabaseClient<Database>;

    const result = await careTasksThisMonth(supabase, "patient-1", EMPTY_CONTEXT, now);

    expect(result.items).toEqual([]);
  });
});

describe("prepareForAppointment", () => {
  const now = new Date("2026-08-15T00:00:00Z");

  it("flags an active medication with a refill date in the past", async () => {
    const supabase = fakeSupabase({
      symptoms: { data: [], error: null },
      medications: { data: [{ drug_name: "Amlodipine", refill_date: "2026-08-01" }], error: null },
    });

    const result = await prepareForAppointment(supabase, "patient-1", EMPTY_CONTEXT, now);

    expect(result.medicationIssues).toEqual([{ drugName: "Amlodipine", issue: "Refill was due 2026-08-01" }]);
  });

  it("carries the next upcoming appointment and recent vitals straight from context", async () => {
    const supabase = fakeSupabase({ symptoms: { data: [], error: null }, medications: { data: [], error: null } });
    const context: PatientContext = {
      ...EMPTY_CONTEXT,
      upcomingAppointments: [{ scheduledFor: "2026-08-20T09:00:00Z", status: "scheduled", reason: "Follow-up" }],
      recentVitals: [{ vitalType: "blood_pressure", value: "130/85", unit: "mmHg", takenAt: "2026-08-10T00:00:00Z" }],
    };

    const result = await prepareForAppointment(supabase, "patient-1", context, now);

    expect(result.nextAppointment).toEqual({ scheduledFor: "2026-08-20T09:00:00Z", reason: "Follow-up" });
    expect(result.recentMeasurements).toEqual([
      { vitalType: "blood_pressure", value: "130/85", unit: "mmHg", takenAt: "2026-08-10T00:00:00Z" },
    ]);
  });

  it("never throws when every extra read errors", async () => {
    const supabase = {
      from: jest.fn(() => chainable({ data: null, error: { message: "boom" } })),
    } as unknown as SupabaseClient<Database>;

    const result = await prepareForAppointment(supabase, "patient-1", EMPTY_CONTEXT, now);

    expect(result.recentSymptoms).toEqual([]);
    expect(result.medicationIssues).toEqual([]);
  });
});
