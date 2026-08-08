import { describe, expect, it } from "@jest/globals";
import {
  isPlausible,
  isVitalsEquivalent,
  toIsoInstant,
  vitalsEquivalentFor,
  WEARABLE_READING_TYPES,
  type NormalisedReading,
} from "./normalise";

function build(overrides: Partial<NormalisedReading> & Pick<NormalisedReading, "readingType" | "value">): NormalisedReading {
  return {
    unit: "unit",
    recordedAt: "2026-08-08T10:00:00.000Z",
    externalReadingId: "test:1",
    ...overrides,
  };
}

describe("routing rule", () => {
  it("sends every metric with a vitals equivalent to vitals_readings", () => {
    // CLAUDE.md's ingestion-boundary rule, asserted rather than assumed:
    // these four (plus BP) must never end up in the parallel table.
    for (const type of ["resting_heart_rate", "weight", "spo2", "glucose", "blood_pressure"] as const) {
      expect(isVitalsEquivalent(type)).toBe(true);
    }
  });

  it("keeps metrics with no vital_type equivalent out of vitals_readings", () => {
    for (const type of ["steps", "sleep_minutes", "hrv_ms", "recovery_score", "strain"] as const) {
      expect(isVitalsEquivalent(type)).toBe(false);
    }
  });

  it("gives every declared reading type a defined routing decision", () => {
    // A new reading type added without a routing decision would silently
    // fall into wearable_readings; this makes that a deliberate choice.
    for (const type of WEARABLE_READING_TYPES) {
      expect(typeof isVitalsEquivalent(type)).toBe("boolean");
    }
  });

  it("maps blood pressure to both of its columns", () => {
    const equivalent = vitalsEquivalentFor("blood_pressure");
    expect(equivalent?.column).toBe("systolic");
    expect(equivalent?.secondaryColumn).toBe("diastolic");
  });
});

describe("isPlausible", () => {
  it("accepts a hypertensive-crisis reading", () => {
    // The single most important value to let through: clamping this away
    // would drop exactly the reading the escalation pipeline exists for.
    expect(isPlausible(build({ readingType: "blood_pressure", value: 210, secondaryValue: 125 }))).toBe(
      true
    );
  });

  it("accepts a severe hypo", () => {
    expect(isPlausible(build({ readingType: "glucose", value: 1.8 }))).toBe(true);
  });

  it("rejects a blood pressure pair recorded the wrong way round", () => {
    expect(isPlausible(build({ readingType: "blood_pressure", value: 80, secondaryValue: 120 }))).toBe(
      false
    );
  });

  it("rejects blood pressure with no diastolic", () => {
    expect(isPlausible(build({ readingType: "blood_pressure", value: 120 }))).toBe(false);
  });

  it("rejects an SpO2 still expressed as a 0-1 fraction", () => {
    // The exact bug the mobile bridge converts away: an unconverted 0.97
    // would read as catastrophic hypoxia once it reached the record.
    expect(isPlausible(build({ readingType: "spo2", value: 0.97 }))).toBe(false);
  });

  it("accepts a real SpO2 percentage", () => {
    expect(isPlausible(build({ readingType: "spo2", value: 97 }))).toBe(true);
  });

  it("rejects a weight that is physiologically impossible", () => {
    expect(isPlausible(build({ readingType: "weight", value: 4 }))).toBe(false);
  });

  it("applies no clinical clamp to non-vitals metrics but still rejects negatives", () => {
    expect(isPlausible(build({ readingType: "steps", value: 43000 }))).toBe(true);
    expect(isPlausible(build({ readingType: "steps", value: -1 }))).toBe(false);
  });

  it("rejects a non-finite value", () => {
    expect(isPlausible(build({ readingType: "weight", value: Number.NaN }))).toBe(false);
  });
});

describe("toIsoInstant", () => {
  it("normalises a date-only string and a full timestamp alike", () => {
    expect(toIsoInstant("2026-08-08")).toBe("2026-08-08T00:00:00.000Z");
    expect(toIsoInstant("2026-08-08T09:30:00Z")).toBe("2026-08-08T09:30:00.000Z");
  });

  it("returns null rather than an invented instant for junk", () => {
    expect(toIsoInstant("not a date")).toBeNull();
    expect(toIsoInstant(undefined)).toBeNull();
    expect(toIsoInstant(null)).toBeNull();
  });
});
