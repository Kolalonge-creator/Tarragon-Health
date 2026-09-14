import { describe, expect, it } from "@jest/globals";
import type { HealthScoreComponentKey } from "./health-score";
import {
  ALL_HEALTH_SCORE_COMPONENT_KEYS,
  HEALTH_SCORE_COMPONENT_HREF,
  HEALTH_SCORE_COMPONENT_LABEL,
} from "./health-score-labels";

const EXPECTED_KEYS: HealthScoreComponentKey[] = [
  "bp_control",
  "hba1c",
  "screening_compliance",
  "vaccination",
  "bmi",
  "smoking",
  "biomarker_heart",
  "biomarker_kidney",
  "biomarker_liver",
];

describe("health-score-labels", () => {
  it("lists every HealthScoreComponentKey exactly once in ALL_HEALTH_SCORE_COMPONENT_KEYS", () => {
    expect([...ALL_HEALTH_SCORE_COMPONENT_KEYS].sort()).toEqual([...EXPECTED_KEYS].sort());
    expect(new Set(ALL_HEALTH_SCORE_COMPONENT_KEYS).size).toBe(ALL_HEALTH_SCORE_COMPONENT_KEYS.length);
  });

  it("gives every component key a non-empty label", () => {
    for (const key of EXPECTED_KEYS) {
      expect(HEALTH_SCORE_COMPONENT_LABEL[key]).toBeTruthy();
    }
  });

  it("gives every component key a patient-app href it can actually navigate to", () => {
    for (const key of EXPECTED_KEYS) {
      expect(HEALTH_SCORE_COMPONENT_HREF[key]).toMatch(/^\/patient\//);
    }
  });

  it("never routes 'smoking' to /patient/smoking — that page writes a table health-score.ts never reads", () => {
    expect(HEALTH_SCORE_COMPONENT_HREF.smoking).not.toContain("/patient/smoking");
  });
});
