import { BP_CARE_V7 } from "./bp-care-v7";
import type { RuleSet, TriageAction } from "../types";

/**
 * Blood pressure triage rule set, version 8 (OQ-551, decided by the owner 2026-10-28): a DRAFT. NOT signed, NOT approved, never applied to
 * production by the build. Only the Chief Medical Officer can sign it, through `approve_triage_rule_set`; an agent never does.
 *
 * What it adds to version 7: every RED rule also creates ONE follow-up task for the clinician, due 24 hours after the grade (`urgent_bp_review`,
 * an existing task type, one a week per patient). The page itself is unchanged: a red grade still shows emergency guidance and pages the on-call
 * clinician at once (INV-05). The follow-up is not a booked consultation and not a paid slot: it asks a doctor to check on the patient the next day
 * and decide what the patient needs. Closing the gap named by journey 2, step "a follow-up is booked automatically" (see docs/OPEN-QUESTIONS.md OQ-551).
 *
 * Built from version 7 so the two cannot drift: a test pins that the only differences are the version, the note for the CMO, and the follow-up
 * action (with a weekly task anchor where a red rule had none) on each red rule; the server row (`..._bp_care_triage_v8_red_follow_up_draft.sql`)
 * derives the same object from the stored version 7 row. The lead time (1440 minutes) and the task type are PROPOSED for the CMO to change.
 */
export const RED_FOLLOW_UP_ACTION: TriageAction = {
  kind: "create_task",
  task: "urgent_bp_review",
  dueMinutes: 1440,
  notifyKey: "notify.triage.task_created",
};

export const BP_CARE_V8: RuleSet = {
  ...BP_CARE_V7,
  version: 8,
  params: {
    ...BP_CARE_V7.params,
    proposedForCmo: {
      ...(BP_CARE_V7.params.proposedForCmo as Record<string, string>),
      redFollowUp:
        "Version 8 adds one follow-up task to every red rule: urgent_bp_review, due 1440 minutes (24 hours) after the grade, one a week per patient (OQ-551, owner decision 2026-10-28). The page is unchanged. The CMO decides the lead time, the task type and whether a red grade should also offer the patient a consultation. Limits the CMO should know: the task is shared with any open amber_bp_review for the patient, so an earlier open one keeps its own due time; a second red in the same ISO week creates no further task while the first is open; a red grade for a Free patient creates no clinical task (two-tier rule).",
    },
  },
  rules: BP_CARE_V7.rules.map((r) =>
    r.grade === "red" ? { ...r, actions: [...r.actions, { ...RED_FOLLOW_UP_ACTION }], taskAnchor: r.taskAnchor ?? "week" } : r,
  ),
};
