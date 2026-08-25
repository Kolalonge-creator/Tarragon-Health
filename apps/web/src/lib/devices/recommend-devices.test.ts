import { annotateWithRecommendation, deviceRecommendationReason } from "./recommend-devices";

describe("deviceRecommendationReason", () => {
  it("recommends a bp_cuff when the patient's care monitors blood_pressure", () => {
    expect(deviceRecommendationReason("bp_cuff", ["blood_pressure"])).toMatch(/blood pressure monitor/);
  });

  it("does not recommend a glucometer for a hypertension-only patient — but this is advisory, never a block", () => {
    // The exact scenario from the ask: a patient enrolled only in hypertension
    // care (monitors blood_pressure, not glucose) selecting a glucometer.
    expect(deviceRecommendationReason("glucometer", ["blood_pressure"])).toBeNull();
  });

  it("recommends a glucometer once glucose is part of the monitored vitals", () => {
    expect(deviceRecommendationReason("glucometer", ["blood_pressure", "glucose"])).toMatch(/glucometer/);
  });

  it("returns null for an empty monitored-vitals list (e.g. no active enrolment)", () => {
    expect(deviceRecommendationReason("bp_cuff", [])).toBeNull();
  });

  it.each([
    ["bp_cuff", "blood_pressure"],
    ["glucometer", "glucose"],
    ["scale", "weight"],
    ["thermometer", "temperature"],
    ["pulse_oximeter", "spo2"],
  ] as const)("maps %s to the %s vital type", (deviceType, vitalType) => {
    expect(deviceRecommendationReason(deviceType, [vitalType])).not.toBeNull();
  });
});

describe("annotateWithRecommendation", () => {
  const offerings = [
    { id: "1", device_type: "glucometer" as const },
    { id: "2", device_type: "bp_cuff" as const },
    { id: "3", device_type: "scale" as const },
  ];

  it("never drops an offering — advisory only, not a purchase gate", () => {
    const result = annotateWithRecommendation(offerings, ["blood_pressure"]);
    expect(result).toHaveLength(offerings.length);
    expect(result.map((r) => r.id).sort()).toEqual(["1", "2", "3"]);
  });

  it("sorts recommended offerings first without losing the unrecommended ones", () => {
    const result = annotateWithRecommendation(offerings, ["blood_pressure"]);
    expect(result[0]).toMatchObject({ id: "2", device_type: "bp_cuff" });
    expect(result[0].recommendationReason).not.toBeNull();
    // The glucometer and scale are still both present, just with no reason.
    const rest = result.slice(1);
    expect(rest.map((r) => r.id).sort()).toEqual(["1", "3"]);
    rest.forEach((r) => expect(r.recommendationReason).toBeNull());
  });

  it("annotates every offering with null when nothing is monitored yet", () => {
    const result = annotateWithRecommendation(offerings, []);
    expect(result).toHaveLength(offerings.length);
    result.forEach((r) => expect(r.recommendationReason).toBeNull());
  });
});
