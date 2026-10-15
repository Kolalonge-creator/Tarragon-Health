import { BP_CARE_V6 } from "./bp-care-v6";
import type { Rule, RuleSet } from "../types";

/**
 * Blood pressure triage rule set, version 7 (follow-up OQ-355): a DRAFT. NOT signed, NOT approved, never applied to production by the build.
 * Only the Chief Medical Officer can sign it, through `approve_triage_rule_set`; an agent never does.
 *
 * What it adds to version 6: rules for a symptom report that has NO blood pressure reading (trigger `symptom`). Until now the engine graded
 * readings only, so a symptom reported alone could not be graded and the live danger-sign path (`handle_symptom_red_flag`) was the only thing
 * that could page. Version 7 gives the engine its own answer for that case, three rules, all PROPOSED for the CMO to change:
 *
 *  - BP-S1 (red): chest pain, weakness or numbness, or difficulty speaking. Emergency guidance and an immediate on-call page.
 *  - BP-S3 (red): in pregnancy or the first weeks after a birth, a convulsion or loss of consciousness (the same emergency BP-P6 grades beside a reading).
 *  - BP-S2 (amber): any other red-flag symptom (severe headache, breathlessness, back pain, confusion, visual disturbance). Emergency guidance
 *    (the same words BP-A6 shows) and the urgent review task, due in 4 hours, one a week per patient.
 *
 * Everything else is version 6 unchanged (the 180/120 line of founder decision D1 included), so signing version 7 also signs those lines and
 * retires the approved version; version 6 stays available if the CMO would rather sign without the symptom rules. Built from version 6 so the two
 * cannot drift: a test pins that the only differences are the version, the new group, the three rules and the note for the CMO, and the server row
 * (`..._fu_bp_care_triage_v7_symptom_alone_draft.sql`) derives the same object from the stored version 6 row.
 *
 * The group `symptomAloneEmergency` is deliberately narrower than `redFlag`: it is the CMO's line between "page now" and "same-day review" for a
 * symptom nobody has measured. Moving a symptom between the two is a one-line change to this group, then a new version.
 */
const taskCreated = "notify.triage.task_created";

const S1: Rule = {
  id: "BP-S1",
  description: "A symptom with no reading: chest pain, weakness or numbness, or difficulty speaking is an emergency",
  triggers: ["symptom"],
  result: "grade",
  grade: "red",
  explanationKey: "EMG-001",
  when: { symptomGroup: "symptomAloneEmergency" },
  actions: [{ kind: "show_emergency_guidance", code: "EMG-001" }, { kind: "page_on_call" }],
};

const S3: Rule = {
  id: "BP-S3",
  description: "A symptom with no reading, in pregnancy or the first 6 weeks after birth: a convulsion or loss of consciousness is an emergency",
  triggers: ["symptom"],
  result: "grade",
  grade: "red",
  explanationKey: "EMG-001",
  when: { all: [{ field: "obstetric", op: "eq", value: true }, { symptomGroup: "obstetricEmergency" }] },
  actions: [{ kind: "show_emergency_guidance", code: "EMG-001" }, { kind: "page_on_call" }],
};

const S2: Rule = {
  id: "BP-S2",
  description: "A symptom with no reading: any other red-flag symptom needs a same-day review",
  triggers: ["symptom"],
  result: "grade",
  grade: "amber",
  explanationKey: "TRI-002",
  when: { symptomGroup: "redFlag" },
  actions: [
    { kind: "show_emergency_guidance", code: "EMG-001" },
    { kind: "create_task", task: "urgent_bp_review", dueMinutes: 240, notifyKey: taskCreated },
  ],
  taskAnchor: "week",
};

export const SYMPTOM_ALONE_EMERGENCY = ["chest_pain", "weakness_or_numbness", "difficulty_speaking"] as const;

export const BP_CARE_V7: RuleSet = {
  ...BP_CARE_V6,
  version: 7,
  params: {
    ...BP_CARE_V6.params,
    symptomGroups: { ...BP_CARE_V6.params.symptomGroups, symptomAloneEmergency: [...SYMPTOM_ALONE_EMERGENCY] },
    proposedForCmo: {
      ...(BP_CARE_V6.params.proposedForCmo as Record<string, string>),
      symptomAlone:
        "Version 7 adds three rules for a symptom reported with no reading (BP-S1, BP-S2, BP-S3). The CMO decides which symptoms page at once (params.symptomGroups.symptomAloneEmergency: chest pain, weakness or numbness, difficulty speaking), whether the other red-flag symptoms should be a same-day review (amber) or also page, and the 4 hour due time.",
    },
  },
  rules: [...BP_CARE_V6.rules, S1, S3, S2],
};
