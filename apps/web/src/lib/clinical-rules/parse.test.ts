import { describe, expect, it } from "@jest/globals";
import { parseClinicalRule } from "./parse";
import type { ClinicalRuleRow } from "./types";

function row(overrides: Partial<ClinicalRuleRow>): ClinicalRuleRow {
  return {
    id: "r1",
    rule_key: "test_rule",
    version: 1,
    name: "Test rule",
    description: "desc",
    category: "monitoring",
    domain: "general",
    event_type: "vital_recorded",
    priority: 50,
    specificity: 10,
    escalation: {},
    suppression: {},
    explanation_template: "x",
    status: "draft",
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
  } as ClinicalRuleRow;
}

describe("parseClinicalRule", () => {
  it("defaults a null population to {op: true}", () => {
    const parsed = parseClinicalRule(row({ population: null }));
    expect(parsed.population).toEqual({ op: "true" });
  });

  it("parses a window + predicate conditions object", () => {
    const parsed = parseClinicalRule(
      row({
        conditions: {
          window: { metric: "vital_reading", vital_type: "blood_pressure", field: "systolic", comparator: "gte", threshold: 160, days: 14 },
          predicate: { op: "gte", field: "window.count", value: 3 },
        },
      })
    );
    expect(parsed.conditions.window?.threshold).toBe(160);
    expect(parsed.conditions.predicate).toEqual({ op: "gte", field: "window.count", value: 3 });
  });

  it("rejects a conditions value that is not an object", () => {
    expect(() => parseClinicalRule(row({ conditions: ["not", "an", "object"] }))).toThrow();
  });

  it("rejects a malformed window spec missing required fields", () => {
    expect(() =>
      parseClinicalRule(row({ conditions: { window: { metric: "vital_reading" } } }))
    ).toThrow(/window/);
  });

  it("parses an actions array and defaults payload to {}", () => {
    const parsed = parseClinicalRule(
      row({ actions: [{ action_type: "notification" }, { action_type: "task", payload: { title: "x" } }] })
    );
    expect(parsed.actions).toHaveLength(2);
    expect(parsed.actions[0].payload).toEqual({});
    expect(parsed.actions[1].payload).toEqual({ title: "x" });
  });

  it("rejects a non-array actions value", () => {
    expect(() => parseClinicalRule(row({ actions: { not: "an array" } }))).toThrow();
  });

  it("rejects an actions entry with no action_type", () => {
    expect(() => parseClinicalRule(row({ actions: [{}] }))).toThrow(/action_type/);
  });
});
