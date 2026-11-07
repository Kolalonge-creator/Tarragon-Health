import type { Enums } from "@tarragon/shared";

/**
 * PD-06 / P13: every new patient-facing string on the Care Plan page, kept in one place so the CMO can read and sign the
 * wording in one go. SIGNED by the CMO (the founder) from chat on 2026-11-07, as written; any change here needs a fresh CMO
 * sign-off. Change it here only; the components read
 * these constants and never carry their own copy for this feature.
 */
export const CARE_PLAN_COPY = {
  loadFailed: "Couldn't load your care plan. Please refresh the page or try again later.",
  lastReviewed: "Last reviewed",
  nextReview: "Next review",
  notReviewedYet: "Not reviewed yet",
  noNextReview: "Not booked yet",
  actionsHeading: "What your plan asks of you",
  noActions: "Your care team has not added any actions to this plan yet.",
  why: "Why",
  when: "When",
  how: "How",
  otherActions: "Other actions",
  changeNoticeTitle: "Your care plan has changed",
  changeNoticeIntro: "Your care team made these changes. Please read them, then tap Got it so they know you have seen them.",
  changeNoticeChangedOn: "Changed on",
  gotIt: "Got it",
  saving: "Saving…",
  ackFailed: "That did not save. Please try again.",
  ackOnlyPatient: (firstName: string | null) =>
    `Only ${firstName ?? "the person whose plan this is"} can confirm these changes, from their own account.`,
  earlierVersions: "Earlier versions",
  earlierVersionsHint: "What your plan looked like before each change",
  noEarlierVersions: "There are no earlier versions of this plan.",
  versionLabel: (n: number) => `Version ${n}`,
  whatChanged: "What changed",
  earlierVersionsLoadFailed: "Couldn't load the earlier versions of your care plan.",
} as const;

/** Plain-words headings for each action category, in the order the patient sees them. */
export const CARE_PLAN_CATEGORY_LABEL: Record<Enums<"care_plan_action_category">, string> = {
  goals: "Your goals",
  tests: "Tests",
  monitoring: "Checks you do at home",
  medicines: "Medicines",
  lifestyle: "Daily habits",
  screening: "Screening",
  consultations: "Appointments with your care team",
  follow_up: "Follow-up",
};
