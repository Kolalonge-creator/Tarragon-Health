import type { Condition } from "../types";
import type { VitalsRuleSet } from "../vitals-engine";

/**
 * Single-reading dangerous vitals rule set (pulse, SpO2, temperature), version 1. DRAFT, NOT SIGNED: every number in `params` is PROPOSED and
 * needs the Chief Medical Officer's signature (`approve_triage_rule_set`) before the server acts on it. The same object is seeded into
 * `triage_rule_sets` as a draft (a test keeps the two identical) and is mirrored in the PROPOSED config key
 * `triage.single_reading_vitals_bands`, which a drift test compares with this file, with the on-device bands (`DEVICE_RED_RULES`) and with the
 * older SQL classifiers. While it is a draft the server grades in SHADOW and the older per-vital alerts (`handle_pulse_reading_red_flag`,
 * `handle_spo2_reading_red_flag`, `handle_temperature_reading_red_flag`) keep running: the same "keep both until parity is shown" rule the CMO gave
 * for blood pressure (Q1) and applied to glucose.
 *
 * The numbers are the ones the older SQL classifiers use today (private.classify_pulse_level, classify_spo2_level, classify_temperature_level),
 * so the divergence report compares like with like. Their guideline basis, per rule, is in docs/research/build-vitals-rule-sets.md. Short form:
 *  - SpO2 under 90 percent: hypoxaemia needing emergency assessment. BTS guideline for oxygen use in adults (target 94 to 98 percent, 88 to 92
 *    percent for those at risk of hypercapnic failure) and NEWS2 (3 points, the top single-parameter score, at 91 or below on scale 1; 2 points at
 *    92 to 93; 1 point at 94 to 95). The platform bands are slightly less sensitive at the red edge (emergency under 90, red to 92, amber to 94).
 *  - Pulse: NEWS2 gives 3 points at 40 or below and at 131 or above, so the older platform bands (35 and 150 for an emergency) are WIDER than
 *    NEWS2's single-parameter red line. They are kept as the starting values because they were chosen to avoid alert fatigue on a single logged
 *    value, and the CMO is shown the NEWS2 comparison to decide.
 *  - Temperature: NEWS2 gives 3 points at 35.0 or below and 2 points at 39.1 or above. WHO IMCI treats 37.5 and above as fever in a young child.
 *
 * Rules run in this order for each metric: the emergency band, the red band, the amber bands (a child's heart rate before the adult amber), then
 * the green. A rule only runs for its own metric (`triggers`).
 */
const taskCreated = "notify.triage.task_created";
const guidance = (code: string) => [{ kind: "show_emergency_guidance" as const, code }, { kind: "page_on_call" as const }];
const underAdultAge: Condition = { field: "age", op: "lt", value: { ref: "params.minAdultAgeYears" } };
const amberReview = [{ kind: "show_message" as const, code: "VIT-T01" }, { kind: "create_task" as const, task: "amber_vitals_review", dueMinutes: 4320, notifyKey: taskCreated }];

export const VITALS_CARE_V1: VitalsRuleSet = {
  code: "vitals_care_triage",
  version: 1,
  status: "draft",
  params: {
    // Typo gates, far wider than any band: the physically possible range. A value outside them is a mis-keyed number, not a crisis.
    validation: { pulseMin: 10, pulseMax: 300, spo2Min: 50, spo2Max: 100, temperatureMin: 25, temperatureMax: 45 },
    minAdultAgeYears: 18,
    pulse: { emergencyAtOrBelow: 35, emergencyAtOrAbove: 150, redAtOrBelow: 39, redAtOrAbove: 121, amberAtOrBelow: 49, amberAtOrAbove: 101 },
    spo2: { emergencyBelow: 90, redAtOrBelow: 92, amberAtOrBelow: 94 },
    temperature: { emergencyAtOrAbove: 40, emergencyBelow: 35, redAtOrAbove: 39, amberAtOrAbove: 38 },
    rejected: { explanationKey: "VIT-T04" },
  },
  rules: [
    // ---- Pulse -------------------------------------------------------------------------------------------------------------------------------
    {
      id: "VT-PU1",
      description: "Heart rate 35 or below, or 150 or above: severe slow or fast heart rate, for everyone",
      triggers: ["pulse"],
      result: "grade",
      grade: "red",
      explanationKey: "VIT-E01",
      when: { any: [{ field: "pulse.bpm", op: "lte", value: { ref: "params.pulse.emergencyAtOrBelow" } }, { field: "pulse.bpm", op: "gte", value: { ref: "params.pulse.emergencyAtOrAbove" } }] },
      actions: guidance("VIT-E01"),
    },
    {
      id: "VT-PU2",
      description: "Heart rate 36 to 39, or 121 to 149, in an adult: same-day care",
      triggers: ["pulse"],
      result: "grade",
      grade: "red",
      explanationKey: "VIT-E02",
      when: {
        all: [
          { any: [{ field: "pulse.bpm", op: "lte", value: { ref: "params.pulse.redAtOrBelow" } }, { field: "pulse.bpm", op: "gte", value: { ref: "params.pulse.redAtOrAbove" } }] },
          { not: underAdultAge },
        ],
      },
      actions: guidance("VIT-E02"),
    },
    {
      id: "VT-PU3",
      description: "Heart rate outside the adult resting range in a patient under 18: adult bands do not apply, routed to a clinician",
      triggers: ["pulse"],
      result: "grade",
      grade: "amber",
      explanationKey: "VIT-T03",
      when: { all: [underAdultAge, { any: [{ field: "pulse.bpm", op: "lte", value: { ref: "params.pulse.amberAtOrBelow" } }, { field: "pulse.bpm", op: "gte", value: { ref: "params.pulse.amberAtOrAbove" } }] }] },
      actions: [{ kind: "show_message", code: "VIT-T03" }, { kind: "route_referral", reason: "age" }, { kind: "create_task", task: "referral_review", dueMinutes: 1440, notifyKey: taskCreated }],
      taskAnchor: "week",
    },
    {
      id: "VT-PU4",
      description: "Heart rate 40 to 49, or 101 to 120: review needed",
      triggers: ["pulse"],
      result: "grade",
      grade: "amber",
      explanationKey: "VIT-T01",
      when: { any: [{ field: "pulse.bpm", op: "lte", value: { ref: "params.pulse.amberAtOrBelow" } }, { field: "pulse.bpm", op: "gte", value: { ref: "params.pulse.amberAtOrAbove" } }] },
      actions: amberReview,
      taskAnchor: "week",
    },
    {
      id: "VT-PU5",
      description: "Heart rate 50 to 100 and nothing above matched: reading saved",
      triggers: ["pulse"],
      result: "grade",
      grade: "green",
      explanationKey: "VIT-T02",
      when: { all: [{ field: "pulse.bpm", op: "gt", value: { ref: "params.pulse.amberAtOrBelow" } }, { field: "pulse.bpm", op: "lt", value: { ref: "params.pulse.amberAtOrAbove" } }] },
      actions: [{ kind: "show_message", code: "VIT-T02" }],
    },
    // ---- Oxygen saturation -------------------------------------------------------------------------------------------------------------------
    {
      id: "VT-OX1",
      description: "SpO2 under 90 percent: low oxygen, emergency",
      triggers: ["spo2"],
      result: "grade",
      grade: "red",
      explanationKey: "VIT-E01",
      when: { field: "spo2.pct", op: "lt", value: { ref: "params.spo2.emergencyBelow" } },
      actions: guidance("VIT-E01"),
    },
    {
      id: "VT-OX2",
      description: "SpO2 90 to 92 percent: low oxygen, same-day care",
      triggers: ["spo2"],
      result: "grade",
      grade: "red",
      explanationKey: "VIT-E02",
      when: { field: "spo2.pct", op: "lte", value: { ref: "params.spo2.redAtOrBelow" } },
      actions: guidance("VIT-E02"),
    },
    {
      id: "VT-OX3",
      description: "SpO2 93 to 94 percent: below target, review needed",
      triggers: ["spo2"],
      result: "grade",
      grade: "amber",
      explanationKey: "VIT-T01",
      when: { field: "spo2.pct", op: "lte", value: { ref: "params.spo2.amberAtOrBelow" } },
      actions: amberReview,
      taskAnchor: "week",
    },
    {
      id: "VT-OX4",
      description: "SpO2 at or below the patient's own clinician-set amber line (only ever turns a green amber)",
      triggers: ["spo2"],
      result: "grade",
      grade: "amber",
      explanationKey: "VIT-T01",
      when: { all: [{ field: "spo2.pct", op: "gt", value: { ref: "params.spo2.amberAtOrBelow" } }, { field: "spo2.pct", op: "lte", value: { ref: "spo2.personalAmberAtOrBelow" } }] },
      actions: amberReview,
      taskAnchor: "week",
    },
    {
      id: "VT-OX5",
      description: "SpO2 95 percent or more and nothing above matched: reading saved",
      triggers: ["spo2"],
      result: "grade",
      grade: "green",
      explanationKey: "VIT-T02",
      when: { field: "spo2.pct", op: "gt", value: { ref: "params.spo2.amberAtOrBelow" } },
      actions: [{ kind: "show_message", code: "VIT-T02" }],
    },
    // ---- Temperature -------------------------------------------------------------------------------------------------------------------------
    {
      id: "VT-TE1",
      description: "Temperature 40.0 or above, or under 35.0: dangerously high or low, emergency",
      triggers: ["temperature"],
      result: "grade",
      grade: "red",
      explanationKey: "VIT-E01",
      when: { any: [{ field: "temperature.c", op: "gte", value: { ref: "params.temperature.emergencyAtOrAbove" } }, { field: "temperature.c", op: "lt", value: { ref: "params.temperature.emergencyBelow" } }] },
      actions: guidance("VIT-E01"),
    },
    {
      id: "VT-TE2",
      description: "Temperature 39.0 to 39.9: high fever, same-day care",
      triggers: ["temperature"],
      result: "grade",
      grade: "red",
      explanationKey: "VIT-E02",
      when: { field: "temperature.c", op: "gte", value: { ref: "params.temperature.redAtOrAbove" } },
      actions: guidance("VIT-E02"),
    },
    {
      id: "VT-TE3",
      description: "Temperature 38.0 to 38.9: fever, review needed",
      triggers: ["temperature"],
      result: "grade",
      grade: "amber",
      explanationKey: "VIT-T01",
      when: { field: "temperature.c", op: "gte", value: { ref: "params.temperature.amberAtOrAbove" } },
      actions: amberReview,
      taskAnchor: "week",
    },
    {
      id: "VT-TE4",
      description: "Temperature at or above the patient's own clinician-set amber line (only ever turns a green amber)",
      triggers: ["temperature"],
      result: "grade",
      grade: "amber",
      explanationKey: "VIT-T01",
      when: { all: [{ field: "temperature.c", op: "lt", value: { ref: "params.temperature.amberAtOrAbove" } }, { field: "temperature.c", op: "gte", value: { ref: "temperature.personalAmberAtOrAbove" } }] },
      actions: amberReview,
      taskAnchor: "week",
    },
    {
      id: "VT-TE5",
      description: "Temperature 35.0 to 37.9 and nothing above matched: reading saved",
      triggers: ["temperature"],
      result: "grade",
      grade: "green",
      explanationKey: "VIT-T02",
      when: { all: [{ field: "temperature.c", op: "gte", value: { ref: "params.temperature.emergencyBelow" } }, { field: "temperature.c", op: "lt", value: { ref: "params.temperature.amberAtOrAbove" } }] },
      actions: [{ kind: "show_message", code: "VIT-T02" }],
    },
  ],
};
