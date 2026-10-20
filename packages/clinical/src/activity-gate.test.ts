import { describe, expect, it } from "@jest/globals";
import { en } from "@tarragon/i18n";
import { getProposedConfig } from "@tarragon/shared";
import {
  activityGate,
  activityGateMessageKey,
  conditionPresent,
  intensityAllowed,
  kindAllowed,
  lowerIntensity,
  parseActivityGate,
  unavailableActivityGate,
  type ActivityConditionRecord,
  type ActivityGateInput,
  type ActivitySafetyConfig,
  type ActivityTriageEvent,
} from "./activity-gate";

const config = getProposedConfig("activity.safety_rules").value as unknown as ActivitySafetyConfig;
const NOW = "2026-10-20T12:00:00Z";
const ago = (hours: number): string => new Date(Date.parse(NOW) - hours * 3_600_000).toISOString();

const ev = (grade: ActivityTriageEvent["grade"], hoursAgo: number, triggerType = "observation"): ActivityTriageEvent => ({ grade, at: ago(hoursAgo), triggerType });
const cond = (name: string, status = "active", icd10: string | null = null): ActivityConditionRecord => ({ name, icd10, status });
const input = (p: Partial<ActivityGateInput> = {}): ActivityGateInput => ({ now: NOW, events: [], conditions: [], pregnancy: null, ...p });

type Case = { id: string; input: ActivityGateInput; decision: string; reason: string; reasons: string[]; max: string; blocked: string[] };
const allow = (id: string, i: ActivityGateInput): Case => ({ id, input: i, decision: "allow", reason: "none", reasons: ["none"], max: "vigorous", blocked: [] });

/** Case ids are shared with packages/db/tests/s48a_activity_safety_gate.sql (activity-gate-parity.test.ts pins them). */
const CASES: Case[] = [
  allow("C01", input()),
  { id: "C02", input: input({ events: [ev("red", 47)] }), decision: "rest", reason: "recent_red_event", reasons: ["recent_red_event"], max: "none", blocked: [] },
  allow("C03", input({ events: [ev("red", 49)] })),
  { id: "C04", input: input({ events: [ev("amber", 10)] }), decision: "restrict", reason: "recent_amber_event", reasons: ["recent_amber_event"], max: "gentle", blocked: [] },
  allow("C05", input({ events: [ev("amber", 49)] })),
  allow("C06", input({ events: [ev("red", -2)] })),
  { id: "C07", input: input({ pregnancy: { isPregnant: true, highRisk: false } }), decision: "restrict", reason: "pregnancy", reasons: ["pregnancy"], max: "moderate", blocked: ["football"] },
  { id: "C08", input: input({ pregnancy: { isPregnant: true, highRisk: true } }), decision: "restrict", reason: "pregnancy_high_risk", reasons: ["pregnancy_high_risk"], max: "gentle", blocked: ["football", "running"] },
  allow("C09", input({ pregnancy: { isPregnant: false, highRisk: true } })),
  allow("C10", input({ conditions: [cond("Essential hypertension")] })),
  { id: "C11", input: input({ conditions: [cond("Essential hypertension", "uncontrolled")] }), decision: "restrict", reason: "hypertension_unsettled", reasons: ["hypertension_unsettled"], max: "gentle", blocked: [] },
  { id: "C12", input: input({ conditions: [cond("High blood pressure")], events: [ev("amber", 120)] }), decision: "restrict", reason: "hypertension_unsettled", reasons: ["hypertension_unsettled"], max: "gentle", blocked: [] },
  { id: "C13", input: input({ conditions: [cond("Hypertension")], events: [ev("red", 120)] }), decision: "restrict", reason: "hypertension_unsettled", reasons: ["hypertension_unsettled"], max: "gentle", blocked: [] },
  allow("C14", input({ conditions: [cond("Hypertension", "resolved")] })),
  { id: "C15", input: input({ conditions: [cond("Rheumatoid ARTHRITIS")] }), decision: "restrict", reason: "arthritis", reasons: ["arthritis"], max: "moderate", blocked: ["football", "running"] },
  { id: "C16", input: input({ conditions: [cond("Chronic complaint", "active", "M54.5")] }), decision: "restrict", reason: "back_pain", reasons: ["back_pain"], max: "moderate", blocked: ["farm_manual_work", "football"] },
  {
    id: "C17",
    input: input({ conditions: [cond("Osteoarthritis"), cond("Lower back pain")], pregnancy: { isPregnant: true, highRisk: false } }),
    decision: "restrict", reason: "pregnancy", reasons: ["pregnancy", "arthritis", "back_pain"], max: "moderate", blocked: ["farm_manual_work", "football", "running"],
  },
  { id: "C18", input: input({ events: [ev("amber", 5)], pregnancy: { isPregnant: true, highRisk: true } }), decision: "restrict", reason: "recent_amber_event", reasons: ["recent_amber_event", "pregnancy_high_risk"], max: "gentle", blocked: ["football", "running"] },
  { id: "C19", input: input({ events: [ev("red", 2)], conditions: [cond("Arthritis")], pregnancy: { isPregnant: true, highRisk: false } }), decision: "rest", reason: "recent_red_event", reasons: ["recent_red_event"], max: "none", blocked: [] },
  { id: "C20", input: input({ conditions: [cond("Hypertension")], events: [ev("amber", 24)] }), decision: "restrict", reason: "recent_amber_event", reasons: ["recent_amber_event", "hypertension_unsettled"], max: "gentle", blocked: [] },
  allow("C21", input({ conditions: [cond("Hypertension")], events: [ev("amber", 120, "symptom_report")] })),
  allow("C22", input({ pregnancy: null })),
  { id: "C23", input: input({ conditions: [cond("Unspecified", "uncontrolled", "I10")] }), decision: "restrict", reason: "hypertension_unsettled", reasons: ["hypertension_unsettled"], max: "gentle", blocked: [] },
  { id: "C26", input: input({ events: [ev("red", 48)] }), decision: "rest", reason: "recent_red_event", reasons: ["recent_red_event"], max: "none", blocked: [] },
];

describe("activityGate", () => {
  for (const c of CASES) {
    it(`${c.id}: ${c.decision} (${c.reasons.join("+")})`, () => {
      const r = activityGate(c.input, config);
      expect(r.decision).toBe(c.decision);
      expect(r.reason).toBe(c.reason);
      expect([...r.reasons]).toEqual(c.reasons);
      expect(r.maxIntensity).toBe(c.max);
      expect([...r.blockedKinds]).toEqual(c.blocked);
    });
  }

  it("C24: no config fails closed to gentle, never to allow", () => {
    const r = activityGate(input(), null);
    expect(r).toMatchObject({ decision: "restrict", reason: "rules_unavailable", maxIntensity: "gentle" });
  });

  it("TS only: an unreadable clock fails closed (SQL takes a typed timestamp)", () => {
    expect(activityGate(input({ now: "not a date" }), config).reason).toBe("rules_unavailable");
  });

  it("acceptance: a red BP event in the last 48 hours returns rest guidance", () => {
    const r = activityGate(input({ events: [{ grade: "red", at: ago(30), triggerType: "observation" }] }), config);
    expect(r.decision).toBe("rest");
    expect(activityGateMessageKey(r)).toBe("activity.gate.rest");
  });
});

describe("helpers", () => {
  it("lowerIntensity picks the gentler of two", () => {
    expect(lowerIntensity("vigorous", "gentle")).toBe("gentle");
    expect(lowerIntensity("gentle", "vigorous")).toBe("gentle");
  });

  it("conditionPresent ignores resolved and historical records and an empty ICD-10 code", () => {
    const m = config.condition_match.arthritis;
    expect(conditionPresent([cond("Arthritis", "historical")], m)).toHaveLength(0);
    expect(conditionPresent([cond("Something", "active", null)], m)).toHaveLength(0);
    expect(conditionPresent([cond("Something", "active", "m17.1")], m)).toHaveLength(1);
  });

  it("kindAllowed refuses on rest, an unknown kind, a blocked kind and an over-intense kind", () => {
    const rest = activityGate(input({ events: [ev("red", 1)] }), config);
    const gentle = activityGate(input({ events: [ev("amber", 1)] }), config);
    const preg = activityGate(input({ pregnancy: { isPregnant: true, highRisk: false } }), config);
    const open = activityGate(input(), config);
    expect(kindAllowed(rest, "walking", config)).toBe(false);
    expect(kindAllowed(open, "unknown_sport", config)).toBe(false);
    expect(kindAllowed(preg, "football", config)).toBe(false);
    expect(kindAllowed(gentle, "running", config)).toBe(false);
    expect(kindAllowed(gentle, "chair_based", config)).toBe(true);
    expect(kindAllowed(open, "running", config)).toBe(true);
  });

  it("intensityAllowed follows the max", () => {
    const gentle = activityGate(input({ events: [ev("amber", 1)] }), config);
    const rest = activityGate(input({ events: [ev("red", 1)] }), config);
    expect(intensityAllowed(gentle, "gentle")).toBe(true);
    expect(intensityAllowed(gentle, "moderate")).toBe(false);
    expect(intensityAllowed(rest, "gentle")).toBe(false);
  });

  it("message keys exist in the English catalogue and never name a reading or condition", () => {
    for (const k of ["activity.gate.rest", "activity.gate.restrict", "activity.gate.allow", "activity.gate.unavailable"] as const) {
      const text = en[k];
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/blood pressure|pregnan|arthritis|diabet|—/i);
    }
    const restrict = activityGate(input({ events: [ev("amber", 1)] }), config);
    expect(activityGateMessageKey(restrict)).toBe("activity.gate.restrict");
    expect(activityGateMessageKey(activityGate(input(), config))).toBe("activity.gate.allow");
  });
});

describe("parseActivityGate", () => {
  const good = { decision: "restrict", reason: "pregnancy", reasons: ["pregnancy"], max_intensity: "moderate", blocked_kinds: ["football"], signed: false };

  it("reads the coarse reason the public door sends in place of a named condition", () => {
    const r = parseActivityGate({ ...good, reason: "health_condition", reasons: ["health_condition"] });
    expect(r.reason).toBe("health_condition");
    expect(r.decision).toBe("restrict");
  });

  it("reads the database answer", () => {
    expect(parseActivityGate(good)).toEqual({ decision: "restrict", reason: "pregnancy", reasons: ["pregnancy"], maxIntensity: "moderate", blockedKinds: ["football"] });
    expect(parseActivityGate({ decision: "rest", reason: "recent_red_event", reasons: ["recent_red_event"], max_intensity: "none", blocked_kinds: [] }).decision).toBe("rest");
  });

  it("fails closed on anything that is not exactly that shape, never to allow", () => {
    const bad: unknown[] = [
      null, "allow", 7,
      { ...good, decision: "yes" }, { ...good, decision: 3 },
      { ...good, reason: "mystery" }, { ...good, reason: 3 },
      { ...good, reasons: "pregnancy" }, { ...good, reasons: ["mystery"] }, { ...good, reasons: [3] },
      { ...good, max_intensity: "extreme" }, { ...good, max_intensity: 3 },
      { ...good, blocked_kinds: "football" }, { ...good, blocked_kinds: [1] },
      { ...good, decision: "rest" },
      { ...good, max_intensity: "none" },
    ];
    for (const b of bad) {
      const r = parseActivityGate(b);
      expect(r.decision).toBe("restrict");
      expect(r.reason).toBe("rules_unavailable");
      expect(r.maxIntensity).toBe("gentle");
    }
    expect(unavailableActivityGate().decision).toBe("restrict");
  });
});
