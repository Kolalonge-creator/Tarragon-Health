import { describe, expect, it } from "@jest/globals";
import { buildEpisodeKey, buildSuppressionKey } from "./suppression";
import type { ParsedClinicalRule } from "./types";

function rule(overrides: Partial<ParsedClinicalRule>): ParsedClinicalRule {
  return {
    id: "r1",
    rule_key: "htn_repeated_high_home_bp_review",
    version: 1,
    name: "test",
    description: "",
    category: "monitoring",
    domain: "general",
    event_type: "vital_recorded",
    priority: 50,
    specificity: 10,
    escalation: {},
    suppression: {},
    explanation_template: "x",
    status: "shadow",
    effective_from: new Date().toISOString(),
    effective_to: null,
    owner_clinical_staff_id: null,
    protocol_version_id: null,
    organisation_id: null,
    patient_id: null,
    approved_by: null,
    approved_at: null,
    activated_at: null,
    retired_at: null,
    retired_reason: null,
    rolled_back_at: null,
    rollback_reason: null,
    supersedes_id: null,
    notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    population: { op: "true" },
    conditions: {},
    actions: [],
    ...overrides,
  };
}

describe("buildSuppressionKey", () => {
  it("is stable for the same rule/patient/dedup-field values", () => {
    const r = rule({ suppression: { dedup_key_fields: ["event.drug_name"] } });
    const key1 = buildSuppressionKey(r, "patient-1", { "event.drug_name": "Metformin" });
    const key2 = buildSuppressionKey(r, "patient-1", { "event.drug_name": "Metformin" });
    expect(key1).toBe(key2);
  });

  it("differs when a dedup field's value differs", () => {
    const r = rule({ suppression: { dedup_key_fields: ["event.drug_name"] } });
    const key1 = buildSuppressionKey(r, "patient-1", { "event.drug_name": "Metformin" });
    const key2 = buildSuppressionKey(r, "patient-1", { "event.drug_name": "Lisinopril" });
    expect(key1).not.toBe(key2);
  });

  it("differs across patients even with identical context", () => {
    const r = rule({ suppression: {} });
    const key1 = buildSuppressionKey(r, "patient-1", {});
    const key2 = buildSuppressionKey(r, "patient-2", {});
    expect(key1).not.toBe(key2);
  });
});

describe("buildEpisodeKey", () => {
  it("returns null when no episode_key_fields are configured", () => {
    const r = rule({ suppression: {} });
    expect(buildEpisodeKey(r, "patient-1", {})).toBeNull();
  });

  it("is stable for matching episode field values", () => {
    const r = rule({ suppression: { episode_key_fields: ["event.vital_type"] } });
    const key1 = buildEpisodeKey(r, "patient-1", { "event.vital_type": "blood_pressure" });
    const key2 = buildEpisodeKey(r, "patient-1", { "event.vital_type": "blood_pressure" });
    expect(key1).toBe(key2);
    expect(key1).not.toBeNull();
  });
});
