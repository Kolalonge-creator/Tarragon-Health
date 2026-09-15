import { describe, expect, it } from "@jest/globals";
import {
  pregnancyLedCareBanner,
  contraceptionCautionNote,
  menopauseTreatmentCautionNote,
} from "./womens-health-intersections";

describe("pregnancyLedCareBanner", () => {
  it("returns null with no relevant active condition", () => {
    expect(pregnancyLedCareBanner([])).toBeNull();
    expect(pregnancyLedCareBanner(["obesity"])).toBeNull();
  });

  it("flags diabetes", () => {
    expect(pregnancyLedCareBanner(["diabetes"])).toContain("diabetes");
  });

  it("flags hypertension", () => {
    expect(pregnancyLedCareBanner(["hypertension"])).toContain("blood pressure");
  });

  it("combines multiple flagged conditions in one banner", () => {
    const banner = pregnancyLedCareBanner(["diabetes", "hypertension"]);
    expect(banner).toContain("diabetes");
    expect(banner).toContain("blood pressure");
  });
});

describe("contraceptionCautionNote", () => {
  it("is null without hypertension or cardiovascular disease", () => {
    expect(contraceptionCautionNote(["diabetes", "obesity"])).toBeNull();
  });

  it("flags hypertension", () => {
    expect(contraceptionCautionNote(["hypertension"])).not.toBeNull();
  });

  it("flags cardiovascular disease", () => {
    expect(contraceptionCautionNote(["cardiovascular"])).not.toBeNull();
  });
});

describe("menopauseTreatmentCautionNote", () => {
  it("is null without hypertension or cardiovascular disease", () => {
    expect(menopauseTreatmentCautionNote([])).toBeNull();
  });

  it("flags cardiovascular disease", () => {
    expect(menopauseTreatmentCautionNote(["cardiovascular"])).not.toBeNull();
  });
});
