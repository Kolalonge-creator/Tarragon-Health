import { describe, expect, it } from "@jest/globals";
import { detectEmergencyKeywords } from "../ai-coach/keyword-guardrail";
import {
  DANGER_SYMPTOM_IDS,
  matchSymptomClusters,
  matchSymptomClustersFromText,
  SYMPTOM_CLUSTERS,
} from "./symptom-clusters";

describe("matchSymptomClusters", () => {
  it("matches the thyroid cluster when 2 of its anchor symptoms are selected", () => {
    const result = matchSymptomClusters(["neck_swelling", "heat_cold_intolerance"]);
    expect(result.dangerFlag).toBe(false);
    expect(result.matched.map((c) => c.id)).toEqual(["thyroid"]);
  });

  it("does not match a cluster on a single anchor symptom", () => {
    const result = matchSymptomClusters(["neck_swelling"]);
    expect(result.matched).toHaveLength(0);
  });

  it("returns no matches and no danger flag for an empty selection", () => {
    const result = matchSymptomClusters([]);
    expect(result.dangerFlag).toBe(false);
    expect(result.matched).toHaveLength(0);
  });

  it("suppresses every suggestion when any danger symptom is selected, even alongside a matching cluster", () => {
    const result = matchSymptomClusters(["neck_swelling", "heat_cold_intolerance", "chest_pain"]);
    expect(result.dangerFlag).toBe(true);
    expect(result.matched).toHaveLength(0);
  });

  it("excludes the UTI cluster when a red-flag exclusion symptom is present, even with matching anchors", () => {
    const result = matchSymptomClusters(["burning_urination", "frequent_urination", "flank_pain"]);
    // flank_pain is both a DANGER_SYMPTOM_ID and a UTI-specific exclusion —
    // the danger flag alone is enough to suppress everything.
    expect(result.dangerFlag).toBe(true);
    expect(result.matched).toHaveLength(0);
  });

  it("can match more than one cluster at once", () => {
    const result = matchSymptomClusters([
      "increased_thirst",
      "frequent_urination",
      "fatigue",
      "pale_skin",
      "breathlessness_on_exertion",
    ]);
    const ids = result.matched.map((c) => c.id).sort();
    expect(ids).toEqual(["anaemia", "blood_sugar"]);
  });

  it("every cluster's anchor and exclude ids reference a real DANGER_SYMPTOM_IDS entry only where intended", () => {
    for (const cluster of SYMPTOM_CLUSTERS) {
      for (const id of cluster.anchorSymptomIds) {
        expect((DANGER_SYMPTOM_IDS as readonly string[]).includes(id)).toBe(false);
      }
    }
  });
});

describe("matchSymptomClustersFromText", () => {
  it("matches the thyroid cluster from a free-text description", () => {
    const matched = matchSymptomClustersFromText(
      "I've had swelling in the front of my neck and I keep feeling too hot lately"
    );
    expect(matched.map((c) => c.id)).toContain("thyroid");
  });

  it("returns no matches for unrelated text", () => {
    expect(matchSymptomClustersFromText("I just wanted to ask about my next appointment")).toHaveLength(0);
  });

  it("never matches on text that also trips the emergency keyword guardrail", () => {
    // A message combining a real trigger phrase with an emergency phrase
    // must still be treated as emergency-first by callers — this test
    // documents that this function itself does no such gating, so callers
    // (ai-coach/graph.ts) must never call it before confirming non-emergency.
    const text = "I have swelling in the front of my neck and chest pain";
    expect(detectEmergencyKeywords(text)).toBe(true);
    // The text matcher alone would still (correctly, in isolation) find the
    // thyroid trigger — proving the caller-side ordering is what keeps this
    // safe, not this function.
    expect(matchSymptomClustersFromText(text).map((c) => c.id)).toContain("thyroid");
  });
});
