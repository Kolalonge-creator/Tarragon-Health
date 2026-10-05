import type { Condition, RuleSet } from "../types";

/**
 * Blood pressure triage rule set, version 1 (spec 6.2). DRAFT: every number in
 * `params` is PROPOSED and needs the Chief Medical Officer's sign-off before the
 * go-live guard opens. The same object is seeded into `triage_rule_sets` (a test
 * keeps the two identical) and bundled in the app for offline red detection.
 *
 * Rules run in this order. Reds first, then the routing rules for pregnancy and
 * age, then the ambers, then the greens. Rules BP-P1 to BP-P4 and BP-A6 are not
 * in the spec's table: they close three gaps the table leaves (a pregnant or
 * under-age user would be graded on adult bands; a red-flag symptom with a
 * reading below the severe line would read as green; a diastolic of 110 to 119
 * with a red-flag symptom matched no rule). They are recorded in OQ-86.
 */
const redFlag: Condition = { symptomGroup: "redFlag" };
const urgentReading: Condition = {
  any: [
    { field: "reading.systolic", op: "gte", value: { ref: "params.urgent.systolic" } },
    { field: "reading.diastolic", op: "gte", value: { ref: "params.urgent.diastolic" } },
  ],
};
const urgentPrevious: Condition = {
  any: [
    { field: "previous.systolic", op: "gte", value: { ref: "params.urgent.systolic" } },
    { field: "previous.diastolic", op: "gte", value: { ref: "params.urgent.diastolic" } },
  ],
};
/** The repeat reading was taken after enough rest, in time, and the first one was also in the urgent range; or the patient never repeated. */
const repeatConfirmed: Condition = {
  any: [
    {
      all: [
        { field: "recheck.kind", op: "eq", value: "repeat" },
        { field: "recheck.minutesSincePrevious", op: "gte", value: { ref: "params.recheck.afterMinutes" } },
        { field: "recheck.minutesSincePrevious", op: "lte", value: { ref: "params.recheck.windowMinutes" } },
        urgentPrevious,
      ],
    },
    { field: "recheck.kind", op: "eq", value: "timed_out" },
  ],
};
const taskCreated = "notify.triage.task_created";

export const BP_CARE_V1: RuleSet = {
  code: "bp_care_triage",
  version: 1,
  status: "draft",
  params: {
    validation: { systolicMin: 60, systolicMax: 299, diastolicMin: 30, diastolicMax: 200 },
    recheck: { afterMinutes: 5, windowMinutes: 15 },
    averageWindowDays: 7,
    minAdultAgeYears: 18,
    severe: { systolic: 180, diastolic: 120 },
    extreme: { systolic: 200, diastolic: 130 },
    urgent: { systolic: 180, diastolic: 110 },
    low: { redSystolic: 90, amberSystolic: 100 },
    average: { overSystolic: 20, overDiastolic: 10, minReadings: 5 },
    adherence: { minPercent: 80 },
    silence: { days: 5 },
    // Pregnancy: NICE NG133 and ACOG CO 767 call 160/110 severe (emergency); 140/90 is raised (same-day assessment).
    pregnancy: { severeSystolic: 160, severeDiastolic: 110, raisedSystolic: 140, raisedDiastolic: 90 },
    symptomGroups: {
      redFlag: [
        "severe_headache",
        "chest_pain",
        "breathlessness",
        "weakness_or_numbness",
        "difficulty_speaking",
        "back_pain",
        "confusion",
        "visual_disturbance",
      ],
      preeclampsiaFlag: ["severe_headache", "visual_disturbance", "epigastric_pain", "breathlessness"],
      lowBpFlag: ["fainting", "confusion", "chest_pain"],
      dizzy: ["dizziness"],
    },
    rejected: { explanationKey: "TRI-006", redFlagGuidanceCode: "EMG-001" },
  },
  rules: [
    {
      id: "BP-R1",
      description: "Severe-range reading with a red-flag symptom",
      triggers: ["observation"],
      result: "grade",
      grade: "red",
      explanationKey: "EMG-001",
      when: {
        all: [
          {
            any: [
              { field: "reading.systolic", op: "gte", value: { ref: "params.severe.systolic" } },
              { field: "reading.diastolic", op: "gte", value: { ref: "params.severe.diastolic" } },
            ],
          },
          redFlag,
        ],
      },
      actions: [{ kind: "show_emergency_guidance", code: "EMG-001" }, { kind: "page_on_call" }],
    },
    {
      id: "BP-R2",
      description: "Extreme reading, with or without symptoms",
      triggers: ["observation"],
      result: "grade",
      grade: "red",
      explanationKey: "EMG-001",
      when: {
        any: [
          { field: "reading.systolic", op: "gte", value: { ref: "params.extreme.systolic" } },
          { field: "reading.diastolic", op: "gte", value: { ref: "params.extreme.diastolic" } },
        ],
      },
      actions: [{ kind: "show_emergency_guidance", code: "EMG-001" }, { kind: "page_on_call" }],
    },
    {
      id: "BP-R3",
      description: "Low pressure with fainting, confusion or chest pain",
      triggers: ["observation"],
      result: "grade",
      grade: "red",
      explanationKey: "EMG-001L",
      when: {
        all: [{ field: "reading.systolic", op: "lt", value: { ref: "params.low.redSystolic" } }, { symptomGroup: "lowBpFlag" }],
      },
      actions: [{ kind: "show_emergency_guidance", code: "EMG-001L" }, { kind: "page_on_call" }],
    },
    {
      id: "BP-P3",
      description: "Pregnancy: severe-range reading is an emergency",
      triggers: ["observation"],
      result: "grade",
      grade: "red",
      explanationKey: "EMG-001",
      when: {
        all: [
          { field: "pregnant", op: "eq", value: true },
          {
            any: [
              { field: "reading.systolic", op: "gte", value: { ref: "params.pregnancy.severeSystolic" } },
              { field: "reading.diastolic", op: "gte", value: { ref: "params.pregnancy.severeDiastolic" } },
            ],
          },
        ],
      },
      actions: [{ kind: "show_emergency_guidance", code: "EMG-001" }, { kind: "page_on_call" }],
    },
    {
      id: "BP-P4",
      description: "Pregnancy: a raised reading with a pre-eclampsia symptom is an emergency",
      triggers: ["observation"],
      result: "grade",
      grade: "red",
      explanationKey: "EMG-001",
      when: {
        all: [
          { field: "pregnant", op: "eq", value: true },
          { symptomGroup: "preeclampsiaFlag" },
          {
            any: [
              { field: "reading.systolic", op: "gte", value: { ref: "params.pregnancy.raisedSystolic" } },
              { field: "reading.diastolic", op: "gte", value: { ref: "params.pregnancy.raisedDiastolic" } },
            ],
          },
        ],
      },
      actions: [{ kind: "show_emergency_guidance", code: "EMG-001" }, { kind: "page_on_call" }],
    },
    {
      id: "BP-P1",
      description: "Pregnancy: not graded on adult bands, routed to a clinician",
      triggers: ["observation"],
      result: "grade",
      grade: "amber",
      explanationKey: "TRI-002",
      when: { field: "pregnant", op: "eq", value: true },
      actions: [
        { kind: "route_referral", reason: "pregnancy" },
        { kind: "create_task", task: "referral_review", dueMinutes: 1440, notifyKey: taskCreated },
      ],
      taskAnchor: "week",
    },
    {
      id: "BP-P2",
      description: "Under the adult age line: routed to a clinician",
      triggers: ["observation"],
      result: "grade",
      grade: "amber",
      explanationKey: "TRI-002",
      when: { field: "age", op: "lt", value: { ref: "params.minAdultAgeYears" } },
      actions: [
        { kind: "route_referral", reason: "age" },
        { kind: "create_task", task: "referral_review", dueMinutes: 1440, notifyKey: taskCreated },
      ],
      taskAnchor: "week",
    },
    {
      id: "BP-A6",
      description: "A red-flag symptom with a reading below the severe line",
      triggers: ["observation"],
      result: "grade",
      grade: "amber",
      explanationKey: "TRI-002",
      when: redFlag,
      actions: [
        { kind: "show_emergency_guidance", code: "EMG-001" },
        { kind: "create_task", task: "urgent_bp_review", dueMinutes: 240, notifyKey: taskCreated },
      ],
      taskAnchor: "reading",
    },
    {
      id: "BP-A1",
      description: "Urgent range without red-flag symptoms, confirmed on repeat after rest (or not repeated in time)",
      triggers: ["observation"],
      result: "grade",
      grade: "amber",
      explanationKey: "TRI-002",
      when: { all: [urgentReading, { not: redFlag }, repeatConfirmed] },
      actions: [{ kind: "create_task", task: "urgent_bp_review", dueMinutes: 240, notifyKey: taskCreated }],
      taskAnchor: "reading",
    },
    {
      id: "BP-A1W",
      description: "Urgent range without red-flag symptoms: ask for a repeat reading after rest before any task",
      triggers: ["observation"],
      result: "recheck",
      explanationKey: "TRI-005",
      when: { all: [urgentReading, { not: redFlag }, { not: repeatConfirmed }] },
      actions: [{ kind: "prompt_recheck", code: "TRI-005" }],
    },
    {
      id: "BP-A2",
      description: "7-day average well above target, with enough readings",
      triggers: ["observation"],
      result: "grade",
      grade: "amber",
      explanationKey: "TRI-002",
      when: {
        all: [
          { field: "avg.count", op: "gte", value: { ref: "params.average.minReadings" } },
          {
            any: [
              { field: "avg.systolicOver", op: "gte", value: { ref: "params.average.overSystolic" } },
              { field: "avg.diastolicOver", op: "gte", value: { ref: "params.average.overDiastolic" } },
            ],
          },
        ],
      },
      actions: [{ kind: "create_task", task: "bp_review", dueMinutes: 1440, notifyKey: taskCreated }],
      taskAnchor: "week",
    },
    {
      id: "BP-A3",
      description: "Low systolic with dizziness",
      triggers: ["observation"],
      result: "grade",
      grade: "amber",
      explanationKey: "TRI-002",
      when: { all: [{ field: "reading.systolic", op: "lt", value: { ref: "params.low.amberSystolic" } }, { symptomGroup: "dizzy" }] },
      actions: [{ kind: "create_task", task: "low_bp_review", dueMinutes: 1440, notifyKey: taskCreated }],
      taskAnchor: "reading",
    },
    {
      id: "BP-A4",
      description: "Care-pack patient: doses taken below the line over 7 days",
      triggers: ["adherence"],
      result: "grade",
      grade: "amber",
      explanationKey: "TRI-002",
      when: {
        all: [
          { field: "pathway.carePack", op: "eq", value: true },
          { field: "adherence.percent7d", op: "lt", value: { ref: "params.adherence.minPercent" } },
        ],
      },
      actions: [{ kind: "create_task", task: "adherence_review", dueMinutes: 2880, notifyKey: taskCreated }],
      taskAnchor: "week",
    },
    {
      id: "BP-A5",
      description: "Care-pack patient: no readings for the silence line",
      triggers: ["silence"],
      result: "grade",
      grade: "amber",
      explanationKey: "TRI-002",
      when: {
        all: [
          { field: "pathway.carePack", op: "eq", value: true },
          { field: "silence.days", op: "gte", value: { ref: "params.silence.days" } },
        ],
      },
      actions: [{ kind: "create_task", task: "silence_check", dueMinutes: 2880, notifyKey: taskCreated }],
      taskAnchor: "lastReadingDate",
    },
    {
      id: "BP-G1",
      description: "Reading within target",
      triggers: ["observation"],
      result: "grade",
      grade: "green",
      explanationKey: "TRI-001",
      when: {
        all: [
          { field: "reading.systolic", op: "lt", value: { ref: "target.systolic" } },
          { field: "reading.diastolic", op: "lt", value: { ref: "target.diastolic" } },
        ],
      },
      actions: [{ kind: "show_message", code: "TRI-001" }],
    },
    {
      id: "BP-G2",
      description: "Above target but no amber rule matched: advice only",
      triggers: ["observation"],
      result: "grade",
      grade: "green",
      explanationKey: "TRI-003",
      when: {
        any: [
          { field: "reading.systolic", op: "gte", value: { ref: "target.systolic" } },
          { field: "reading.diastolic", op: "gte", value: { ref: "target.diastolic" } },
        ],
      },
      actions: [{ kind: "show_message", code: "TRI-003" }],
    },
  ],
};
