import { buildBpChart, buildBpSection, buildSkipped, buildSymptoms, summaryConfig, SECTION_KEYS, type BpReadingIn } from "./model";
import type { DoctorSummaryData } from "./load";

/**
 * Invented data for tests and the render script. Not a real person. Includes the cases the summary must handle: a wearable
 * reading with a wild value (must not move the average), a reading that failed validation, a reproductive symptom type (must be
 * left out), a skipped dose with a reason.
 */
export const SAMPLE_NOW_MS = Date.parse("2026-10-16T09:00:00Z");

export function sampleReadings(): BpReadingIn[] {
  const out: BpReadingIn[] = [];
  for (let i = 0; i < 12; i += 1) {
    out.push({
      takenAt: new Date(SAMPLE_NOW_MS - (i * 2 + 1) * 24 * 60 * 60 * 1000).toISOString(),
      systolic: 130 + (i % 4) * 3,
      diastolic: 82 + (i % 3) * 2,
      pulse: 70 + (i % 5),
      source: i % 3 === 0 ? "device" : "manual",
      validationStatus: "valid",
    });
  }
  out.push({ takenAt: new Date(SAMPLE_NOW_MS - 3600_000).toISOString(), systolic: 190, diastolic: 120, pulse: 99, source: "wearable", validationStatus: "valid" });  // band-ok: sample fixture reading for the layout test, not a classification
  out.push({ takenAt: new Date(SAMPLE_NOW_MS - 7200_000).toISOString(), systolic: 80, diastolic: 40, pulse: null, source: "manual", validationStatus: "rejected" });  // band-ok: sample fixture reading for the layout test, not a classification
  return out;
}

const skippedWith = (...a: Parameters<typeof buildSkipped>) => ({ ...buildSkipped(...a), capped: false });

export function sampleData(sections: DoctorSummaryData["sections"] = [...SECTION_KEYS]): DoctorSummaryData {
  const cfg = summaryConfig();
  const bp = buildBpSection(sampleReadings(), cfg);
  return {
    generatedAtMs: SAMPLE_NOW_MS,
    days: 30,
    sinceDate: "2026-09-16",
    sections,
    patient: { name: "Ada Sample", dateOfBirth: "1971-03-02", sex: "female", patientNumber: "TH-000123" },
    bp,
    chart: buildBpChart(bp.chartReadings),
    medicines: [
      { name: "Amlodipine", dose: "5 mg", schedule: "every day at 08:00", provenance: "signed_prescription" },
      { name: "Metformin", dose: "500 mg", schedule: "every day at 08:00, 20:00, with food", provenance: "patient" },
    ],
    adherence: {
      minDoses: 5,
      hasScheduledMedicines: true,
      weeks: [
        { weekStart: "2026-10-09", weekEnd: "2026-10-15", due: 21, markedTaken: 19, late: 2, skipped: 1, noRecord: 1, couldNotGet: 0, percent: 90 },
        { weekStart: "2026-10-02", weekEnd: "2026-10-08", due: 21, markedTaken: 15, late: 1, skipped: 3, noRecord: 3, couldNotGet: 0, percent: 71 },
        { weekStart: "2026-09-25", weekEnd: "2026-10-01", due: 3, markedTaken: 2, late: 0, skipped: 0, noRecord: 1, couldNotGet: 0, percent: null },
      ],
    },
    skipped: skippedWith(
      [
        { date: "2026-10-12", time: "20:00", medicine: "Metformin", missedReason: "feels_well", reason: "felt fine after supper" },
        { date: "2026-10-04", time: "08:00", medicine: "Amlodipine", missedReason: "forgot", reason: null },
      ],
      cfg,
    ),
    symptoms: buildSymptoms(
      [
        { reportedAt: "2026-10-14T18:00:00Z", symptomType: "dizziness", freeText: "On standing up quickly, passed in a minute.", severity: 3 },
        { reportedAt: "2026-10-10T07:00:00Z", symptomType: "testicular_pain", freeText: "should never print", severity: 4 },
        { reportedAt: "2026-07-01T07:00:00Z", symptomType: "fatigue", freeText: "older than the period", severity: 2 },
      ],
      SAMPLE_NOW_MS - 30 * 24 * 60 * 60 * 1000,
      cfg,
    ),
    allergiesConditions: { allergies: [{ allergen: "Penicillin", detail: "rash, moderate", provenance: "patient" }], conditions: ["hypertension", "diabetes"] },
  };
}
