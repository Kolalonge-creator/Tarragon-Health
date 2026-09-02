import { describe, expect, it } from "@jest/globals";
import { resolveConflicts } from "./conflict";
import type { ParsedClinicalRule } from "./types";

/** Minimal fixture — conflict.ts only reads id, rule_key, specificity, priority, actions[0]. */
function rule(overrides: Partial<ParsedClinicalRule> & { id: string }): ParsedClinicalRule {
  return {
    rule_key: overrides.rule_key ?? overrides.id,
    version: 1,
    name: overrides.name ?? overrides.id,
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
    actions: [{ action_type: "task" }],
    ...overrides,
  };
}

describe("resolveConflicts", () => {
  it("a rule with no competitor for its action type always wins", () => {
    const a = rule({ id: "a", actions: [{ action_type: "notification" }] });
    const { winners, losers } = resolveConflicts([a]);
    expect(winners).toEqual([a]);
    expect(losers.size).toBe(0);
  });

  it("higher specificity wins regardless of priority", () => {
    const general = rule({ id: "general", specificity: 10, priority: 90 });
    const patientSpecific = rule({ id: "specific", specificity: 90, priority: 10 });
    const { winners, losers } = resolveConflicts([general, patientSpecific]);
    expect(winners).toEqual([patientSpecific]);
    expect(losers.get("general")).toBe(patientSpecific);
  });

  it("priority is the tie-break only within equal specificity", () => {
    const low = rule({ id: "low", specificity: 40, priority: 10 });
    const high = rule({ id: "high", specificity: 40, priority: 90 });
    const { winners, losers } = resolveConflicts([low, high]);
    expect(winners).toEqual([high]);
    expect(losers.get("low")).toBe(high);
  });

  it("rules with different primary action types never conflict", () => {
    const a = rule({ id: "a", actions: [{ action_type: "task" }] });
    const b = rule({ id: "b", actions: [{ action_type: "notification" }] });
    const { winners, losers } = resolveConflicts([a, b]);
    expect(winners.sort((x, y) => x.id.localeCompare(y.id))).toEqual([a, b]);
    expect(losers.size).toBe(0);
  });

  it("a rule with no actions never conflicts with anything", () => {
    const a = rule({ id: "a", actions: [] });
    const b = rule({ id: "b", actions: [] });
    const { winners, losers } = resolveConflicts([a, b]);
    expect(winners.sort((x, y) => x.id.localeCompare(y.id))).toEqual([a, b]);
    expect(losers.size).toBe(0);
  });
});
