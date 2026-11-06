import { describe, expect, it } from "@jest/globals";
import { normaliseTrackedPath } from "./normalise-path";

describe("normaliseTrackedPath", () => {
  it("leaves ordinary pages alone", () => {
    expect(normaliseTrackedPath("/")).toBe("/");
    expect(normaliseTrackedPath("/pricing")).toBe("/pricing");
    expect(normaliseTrackedPath("/patient/vitals")).toBe("/patient/vitals");
    expect(normaliseTrackedPath("/patient/learn/bp-basics")).toBe("/patient/learn/bp-basics");
  });

  it("replaces record identifiers with :id", () => {
    expect(normaliseTrackedPath("/patient/consultation/0f8fad5b-d9cb-469f-a165-70867728950e")).toBe("/patient/consultation/:id");
    expect(normaliseTrackedPath("/clinician/patients/0F8FAD5B-D9CB-469F-A165-70867728950E/records/12345")).toBe(
      "/clinician/patients/:id/records/:id",
    );
    expect(normaliseTrackedPath("/patient/supporting/join/a1b2c3d4e5f6g7h8i9j0k1l2")).toBe("/patient/supporting/join/:id");
  });

  it("buckets sensitive patient topics, including their sub-pages", () => {
    for (const p of [
      "/patient/sexual-health",
      "/patient/sexual-health/results",
      "/patient/cycle",
      "/patient/contraception",
      "/patient/pregnancy/0f8fad5b-d9cb-469f-a165-70867728950e",
      "/patient/wellbeing/library",
      "/patient/alcohol",
      "/patient/Sexual-Health",
    ]) {
      expect(normaliseTrackedPath(p)).toBe("/patient/(private)");
    }
  });

  it("drops query strings and fragments", () => {
    expect(normaliseTrackedPath("/patient/labs?show=pathology#x")).toBe("/patient/labs");
  });

  it("does not bucket a public marketing page that shares a word", () => {
    expect(normaliseTrackedPath("/conditions/pregnancy")).toBe("/conditions/pregnancy");
  });
});
