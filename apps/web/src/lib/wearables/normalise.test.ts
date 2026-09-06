import { describe, expect, it } from "@jest/globals";
import {
  consentCategoryFor,
  consentDecisionFor,
  feedsSafetyPipeline,
  FULL_WEARABLE_CONSENT,
  isConsentedTo,
  isPlausible,
  isVitalsEquivalent,
  toIsoInstant,
  vitalsEquivalentFor,
  WEARABLE_READING_TYPES,
  type NormalisedReading,
  type WearableConsent,
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
    for (const type of [
      "resting_heart_rate",
      "weight",
      "spo2",
      "glucose",
      "blood_pressure",
      // respiratory_rate was missing here for as long as
      // vitals_readings.respiratory_rate_bpm has existed, so Oura's and
      // WHOOP's breaths/min landed in wearable_readings only.
      "respiratory_rate",
    ] as const) {
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

describe("consent categories (53.3/53.4)", () => {
  it("categorises every gated reading type into exactly one of the four named categories", () => {
    expect(consentCategoryFor("steps")).toBe("activity");
    expect(consentCategoryFor("calories")).toBe("activity");
    expect(consentCategoryFor("resting_heart_rate")).toBe("heart_rate");
    expect(consentCategoryFor("hrv_ms")).toBe("heart_rate");
    expect(consentCategoryFor("respiratory_rate")).toBe("heart_rate");
    expect(consentCategoryFor("sleep_minutes")).toBe("sleep");
    expect(consentCategoryFor("sleep_efficiency")).toBe("sleep");
    expect(consentCategoryFor("weight")).toBe("weight");
  });

  it("leaves clinically-significant metrics ungated — consent never filters them", () => {
    // glucose/blood_pressure/spo2 already flow through vitals_readings' own
    // plan-gated red-flag pipeline; a second consumer-facing checkbox in
    // front of them would be the wrong kind of friction (see the migration).
    for (const type of ["glucose", "blood_pressure", "spo2"] as const) {
      expect(consentCategoryFor(type)).toBeNull();
    }
  });

  function reading(readingType: NormalisedReading["readingType"]): NormalisedReading {
    return build({ readingType, value: 1 });
  }

  it("permits a reading whose category is granted", () => {
    expect(isConsentedTo(reading("steps"), FULL_WEARABLE_CONSENT)).toBe(true);
  });

  it("denies a reading whose category was explicitly turned off", () => {
    const consent: WearableConsent = { ...FULL_WEARABLE_CONSENT, sleep: false };
    expect(isConsentedTo(reading("sleep_minutes"), consent)).toBe(false);
    // A denied category must not leak into an unrelated one.
    expect(isConsentedTo(reading("steps"), consent)).toBe(true);
  });

  it("routes respiratory rate to the integer respiratory_rate_bpm column", () => {
    const equivalent = vitalsEquivalentFor("respiratory_rate");
    expect(equivalent).toMatchObject({
      vitalType: "respiratory_rate",
      column: "respiratory_rate_bpm",
      integer: true,
    });
  });

  it("always permits an ungated metric regardless of consent", () => {
    const consent: WearableConsent = {
      activity: false,
      heart_rate: false,
      sleep: false,
      weight: false,
    };
    expect(isConsentedTo(reading("glucose"), consent)).toBe(true);
  });
});

describe("consent never switches off a safety classifier", () => {
  const denyAll: WearableConsent = {
    activity: false,
    heart_rate: false,
    sleep: false,
    weight: false,
  };

  function reading(readingType: NormalisedReading["readingType"]): NormalisedReading {
    return build({ readingType, value: 1 });
  }

  it("names exactly the reading types that arm a red-flag trigger", () => {
    // Verified against the live triggers on vitals_readings:
    // vitals_readings_pulse_red_flag and
    // vitals_readings_heart_failure_weight_gain. Glucose, blood pressure and
    // SpO2 are in the same class and are already outside the consent model
    // entirely, so they need no exemption.
    expect(feedsSafetyPipeline("resting_heart_rate")).toBe(true);
    expect(feedsSafetyPipeline("weight")).toBe(true);
    for (const type of ["steps", "calories", "sleep_minutes", "sleep_efficiency", "hrv_ms"] as const) {
      expect(feedsSafetyPipeline(type)).toBe(false);
    }
  });

  it("does not exempt respiratory rate, which no classifier reads", () => {
    // It routes to vitals_readings now, but nothing on the platform bands
    // it — so gating it costs no safety signal and the heart_rate toggle
    // keeps a real effect.
    expect(feedsSafetyPipeline("respiratory_rate")).toBe(false);
    expect(consentDecisionFor(reading("respiratory_rate"), denyAll)).toBe("denied");
  });

  it("retains a denied pulse or weight reading instead of dropping it", () => {
    expect(consentDecisionFor(reading("resting_heart_rate"), denyAll)).toBe(
      "denied_safety_retained"
    );
    expect(consentDecisionFor(reading("weight"), denyAll)).toBe("denied_safety_retained");
  });

  it("drops a denied passive metric outright", () => {
    for (const type of ["steps", "sleep_minutes", "hrv_ms"] as const) {
      expect(consentDecisionFor(reading(type), denyAll)).toBe("denied");
    }
  });

  it("allows everything when consent is full", () => {
    for (const type of WEARABLE_READING_TYPES) {
      expect(consentDecisionFor(reading(type), FULL_WEARABLE_CONSENT)).toBe("allowed");
    }
  });

  it("keeps the patient's stated preference recorded even where it is overridden", () => {
    // The exemption is about what gets stored, not about pretending the
    // patient said yes: isConsentedTo still reports the denial, which is
    // what makes the deniedByConsent count honest.
    expect(isConsentedTo(reading("resting_heart_rate"), denyAll)).toBe(false);
  });
});
