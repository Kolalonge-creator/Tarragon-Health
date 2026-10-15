import type { Condition } from "../types";
import type { GlucoseRuleSet } from "../glucose-engine";

/**
 * Glucose triage rule set, version 1 (plan item R2, CMO decisions Q6 to Q9 of 2026-10-07). DRAFT, NOT SIGNED: every number in `params`
 * is PROPOSED and needs the Chief Medical Officer's signature (`approve_triage_rule_set`) before the server acts on it. The same object is
 * seeded into `triage_rule_sets` as a draft (a test keeps the two identical) and bundled in the app for offline red detection. While it
 * is a draft the server grades in SHADOW and the older glucose pipeline (`glucose-red-flags`, the SQL backstop) keeps running, the same
 * "keep both until parity is shown" rule the CMO gave for blood pressure (Q1).
 *
 * Guideline basis, per rule, is in docs/research/S11-S15-glucose.md. Short form:
 *  - Hypoglycaemia levels: ADA Standards of Care 2026 section 6 (level 1 under 3.9 and at least 3.0; level 2 under 3.0; level 3 is a severe
 *    event with altered mental or physical state needing help from another person, at any glucose value). ISPAD 2022 uses the same
 *    3.9 and 3.0 values for children.
 *  - Suspected DKA and ketones: ADA/EASD 2024 consensus on hyperglycaemic crises (beta-hydroxybutyrate 3.0 mmol/L or more); the 1.5 to
 *    2.9 intermediate band is JBDS/ISPAD sick-day practice and the CMO's own judgement (Q7).
 *  - Very high glucose: ADA/EASD 2024 (hyperosmolar hyperglycaemic state is typically 33.3 mmol/L or more); 20.0 is the CMO's urgent line (Q8).
 *  - Who it grades: adults 18 and over with type 1 or type 2 diabetes. Pregnancy, under 18 and other diabetes types are routed to a clinician
 *    (amber), while the severe-hypoglycaemia and suspected-DKA reds apply to everyone (Q9).
 *
 * Rules run in this order: reds first, then the level 1 low (GL-A1P before GL-A1, so a pregnant, young or non-type-1-or-2 patient gets the treat-now message AND the
 * routing), then the urgent ambers (for GL-A2 and GL-A3 the urgent same-day review IS the routing to a clinician, and is stricter than the weekly referral review),
 * then the routing ambers, then the green. Open points the CMO should see
 * when signing are listed in docs/design/S11-S15-glucose-closeout.md (no diabetes type recorded is graded as an adult; ketones of 3.0 or
 * more with symptoms are red even when glucose is under 11.0; urine moderate or large counts as raised ketones).
 */
const severeSigns: Condition = { symptomGroup: "severeHypoSigns" };
const ketonesRaised: Condition = { field: "ketone.raised", op: "eq", value: true };
const ketonesAtDkaLine: Condition = {
  any: [
    { field: "ketone.bloodMmol", op: "gte", value: { ref: "params.ketone.dka" } },
    { field: "ketone.urineRaised", op: "eq", value: true },
  ],
};
const taskCreated = "notify.triage.task_created";
const guidance = (code: string) => [{ kind: "show_emergency_guidance" as const, code }, { kind: "page_on_call" as const }];

export const GLUCOSE_CARE_V1: GlucoseRuleSet = {
  code: "glucose_care_triage",
  version: 1,
  status: "draft",
  params: {
    // Typo gates, far wider than any band and wider than both entry forms (web and phone accept 1.0 mmol/L and 18 mg/dL, which is 1.0): 0.5 mmol/L is 9 mg/dL
    // and 55.5 is 1000 mg/dL, so every value a person can enter is graded and a true severe low is never "implausible". Blood ketones above the meter range
    // (web accepts up to 20) are clamped to it, not rejected.
    validation: { glucoseMinMmol: 0.5, glucoseMaxMmol: 55.5, ketoneMaxMmol: 20 },
    minAdultAgeYears: 18,
    hypo: { severe: 3.0, alert: 3.9 },
    high: { dka: 11.0, urgent: 20.0, severe: 33.3 },
    ketone: { raised: 1.5, dka: 3.0 },
    symptomGroups: {
      // ADA level 3 signs: altered mental or physical state, needs help from another person.
      severeHypoSigns: ["confusion", "seizure", "unconscious", "cannot_swallow"],
      // Warning signs of ketoacidosis with raised ketones.
      dkaSigns: ["vomiting", "abdominal_pain", "fast_breathing", "drowsiness"],
      // Signs that turn a very high glucose into an emergency (Q8).
      hyperSigns: ["vomiting", "drowsiness", "confusion", "very_thirsty_cannot_keep_fluids"],
      // Shown as emergency guidance even when the reading itself is rejected as implausible.
      redFlag: ["confusion", "seizure", "unconscious", "cannot_swallow"],
    },
    rejected: { explanationKey: "GLU-T06", redFlagGuidanceCode: "GLU-E02" },
  },
  rules: [
    {
      id: "GL-R1",
      description: "Glucose under 3.0 (ADA level 2 hypoglycaemia), for everyone",
      triggers: ["glucose"],
      result: "grade",
      grade: "red",
      explanationKey: "GLU-E01",
      when: { field: "glucose.mmol", op: "lt", value: { ref: "params.hypo.severe" } },
      actions: guidance("GLU-E01"),
    },
    {
      id: "GL-R2",
      description: "Low glucose with confusion, seizure, unconsciousness or unable to swallow (ADA level 3), for everyone",
      triggers: ["glucose"],
      result: "grade",
      grade: "red",
      explanationKey: "GLU-E01",
      when: { all: [{ field: "glucose.mmol", op: "lt", value: { ref: "params.hypo.alert" } }, severeSigns] },
      actions: guidance("GLU-E01"),
    },
    {
      id: "GL-R3",
      description: "Any glucose with confusion, seizure, unconsciousness or unable to swallow (ADA level 3), for everyone",
      triggers: ["glucose"],
      result: "grade",
      grade: "red",
      explanationKey: "GLU-E02",
      when: severeSigns,
      actions: guidance("GLU-E02"),
    },
    {
      id: "GL-R4",
      description: "Suspected DKA: glucose 11.0 or more with blood ketones 3.0 or more, or urine ketones moderate or large, for everyone",
      triggers: ["glucose"],
      result: "grade",
      grade: "red",
      explanationKey: "GLU-E02",
      when: { all: [{ field: "glucose.mmol", op: "gte", value: { ref: "params.high.dka" } }, ketonesAtDkaLine] },
      actions: guidance("GLU-E02"),
    },
    {
      id: "GL-R5",
      description: "Raised ketones (1.5 or more, or urine moderate or large) with vomiting, abdominal pain, fast breathing or drowsiness",
      triggers: ["glucose"],
      result: "grade",
      grade: "red",
      explanationKey: "GLU-E02",
      when: { all: [ketonesRaised, { symptomGroup: "dkaSigns" }] },
      actions: guidance("GLU-E02"),
    },
    {
      id: "GL-R6",
      description: "Glucose 33.3 or more, whatever else is known",
      triggers: ["glucose"],
      result: "grade",
      grade: "red",
      explanationKey: "GLU-E02",
      when: { field: "glucose.mmol", op: "gte", value: { ref: "params.high.severe" } },
      actions: guidance("GLU-E02"),
    },
    {
      id: "GL-R7",
      description: "Glucose 20.0 or more with vomiting, drowsiness, confusion or very thirsty and not keeping fluids down",
      triggers: ["glucose"],
      result: "grade",
      grade: "red",
      explanationKey: "GLU-E02",
      when: { all: [{ field: "glucose.mmol", op: "gte", value: { ref: "params.high.urgent" } }, { symptomGroup: "hyperSigns" }] },
      actions: guidance("GLU-E02"),
    },
    {
      id: "GL-A1P",
      description: "Glucose 3.0 to 3.8 (ADA level 1) in pregnancy, under 18, or with gestational or other diabetes: treat now with fast sugar, and routed to a clinician",
      triggers: ["glucose"],
      result: "grade",
      grade: "amber",
      explanationKey: "GLU-T01",
      when: {
        all: [
          { field: "glucose.mmol", op: "gte", value: { ref: "params.hypo.severe" } },
          { field: "glucose.mmol", op: "lt", value: { ref: "params.hypo.alert" } },
          { any: [{ field: "pregnant", op: "eq", value: true }, { field: "age", op: "lt", value: { ref: "params.minAdultAgeYears" } }, { field: "diabetes.type", op: "eq", value: "gestational" }, { field: "diabetes.type", op: "eq", value: "other" }] },
        ],
      },
      actions: [{ kind: "show_message", code: "GLU-T01" }, { kind: "route_referral", reason: "population" }, { kind: "create_task", task: "referral_review", dueMinutes: 1440, notifyKey: taskCreated }],
      taskAnchor: "week",
    },
    {
      id: "GL-A1",
      description: "Glucose 3.0 to 3.8 (ADA level 1 hypoglycaemia): treat now with fast sugar and recheck",
      triggers: ["glucose"],
      result: "grade",
      grade: "amber",
      explanationKey: "GLU-T01",
      when: { all: [{ field: "glucose.mmol", op: "gte", value: { ref: "params.hypo.severe" } }, { field: "glucose.mmol", op: "lt", value: { ref: "params.hypo.alert" } }] },
      actions: [{ kind: "show_message", code: "GLU-T01" }],
    },
    {
      id: "GL-A2",
      description: "Raised ketones without the warning signs: urgent same-day review",
      triggers: ["glucose"],
      result: "grade",
      grade: "amber",
      explanationKey: "GLU-T02",
      when: ketonesRaised,
      actions: [{ kind: "show_message", code: "GLU-T02" }, { kind: "create_task", task: "urgent_glucose_review", dueMinutes: 480, notifyKey: taskCreated }],
      taskAnchor: "reading",
    },
    {
      id: "GL-A3",
      description: "Glucose 20.0 or more: urgent same-day review",
      triggers: ["glucose"],
      result: "grade",
      grade: "amber",
      explanationKey: "GLU-T03",
      when: { field: "glucose.mmol", op: "gte", value: { ref: "params.high.urgent" } },
      actions: [{ kind: "show_message", code: "GLU-T03" }, { kind: "create_task", task: "urgent_glucose_review", dueMinutes: 480, notifyKey: taskCreated }],
      taskAnchor: "reading",
    },
    {
      id: "GL-P1",
      description: "Pregnancy: not graded on adult bands, routed to a clinician",
      triggers: ["glucose"],
      result: "grade",
      grade: "amber",
      explanationKey: "GLU-T04",
      when: { field: "pregnant", op: "eq", value: true },
      actions: [{ kind: "route_referral", reason: "pregnancy" }, { kind: "create_task", task: "referral_review", dueMinutes: 1440, notifyKey: taskCreated }],
      taskAnchor: "week",
    },
    {
      id: "GL-P2",
      description: "Under the adult age line: routed to a clinician",
      triggers: ["glucose"],
      result: "grade",
      grade: "amber",
      explanationKey: "GLU-T04",
      when: { field: "age", op: "lt", value: { ref: "params.minAdultAgeYears" } },
      actions: [{ kind: "route_referral", reason: "age" }, { kind: "create_task", task: "referral_review", dueMinutes: 1440, notifyKey: taskCreated }],
      taskAnchor: "week",
    },
    {
      id: "GL-P3",
      description: "Gestational or other diabetes type: not graded on type 1 and type 2 bands, routed to a clinician",
      triggers: ["glucose"],
      result: "grade",
      grade: "amber",
      explanationKey: "GLU-T04",
      when: { any: [{ field: "diabetes.type", op: "eq", value: "gestational" }, { field: "diabetes.type", op: "eq", value: "other" }] },
      actions: [{ kind: "route_referral", reason: "diabetes_type" }, { kind: "create_task", task: "referral_review", dueMinutes: 1440, notifyKey: taskCreated }],
      taskAnchor: "week",
    },
    {
      id: "GL-G1",
      description: "Glucose at 3.9 or more and nothing above matched: reading saved",
      triggers: ["glucose"],
      result: "grade",
      grade: "green",
      explanationKey: "GLU-T05",
      when: { field: "glucose.mmol", op: "gte", value: { ref: "params.hypo.alert" } },
      actions: [{ kind: "show_message", code: "GLU-T05" }],
    },
  ],
};
