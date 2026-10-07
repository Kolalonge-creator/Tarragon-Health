// S85: the four D.7.3 journeys as typed step lists (spec lines 2257-2304).
//
// A step that depends on something not built (or not signed) carries `pending` here, with the owner session. That makes the
// list of what is missing a reviewable piece of data: Jest checks every owner is a real session in the v5 index, and the
// journeys call `startJourney` so each known-pending step is resolved as pending before any test code runs.
//
// A step with no `pending` entry is expected to RUN in the journey's spec and pass or fail on what the platform does today.
// A spec may still mark such a step pending at run time (for example the queue and page steps while the BP rule set is only a
// draft), and says why; those dynamic cases are not counted here.

import { JourneyRun, type StepDeclaration } from "./steps";

export type JourneyId = "J1" | "J2" | "J3" | "J4";

export interface JourneyStepDef extends StepDeclaration {
  readonly pending?: { readonly owner: string; readonly reason: string };
}

export interface JourneyDef {
  readonly id: JourneyId;
  readonly title: string;
  readonly spec: string;
  readonly steps: readonly JourneyStepDef[];
}

export const J1: JourneyDef = {
  id: "J1",
  title: "Journey 1: a new user's first month (spine test)",
  spec: "D.7.3 Journey 1",
  steps: [
    { id: "phone-signup-code", title: "Sign up with a phone number verified by a code (local test OTP, real GoTrue)" },
    { id: "password-set", title: "Set a password and sign in again with it" },
    { id: "goal-blood-pressure", title: "Onboarding records the goal 'blood pressure'", pending: { owner: "S41", reason: "Module 1 onboarding goals are built in S41; the live onboarding asks a different first question and stores no goal list" } },
    { id: "risk-questionnaire-high-cv-risk", title: "Risk questionnaire places her at high cardiovascular risk", pending: { owner: "S45", reason: "Module 3 risk engine and questionnaire are S45" } },
    { id: "screening-calendar-essential-due", title: "Screening calendar shows the Essential screen due", pending: { owner: "S45", reason: "screening calendar and packages are S45" } },
    { id: "order-created-for-screen", title: "Create an order for the paid product (the membership) as the patient (real session, pending payment)" },
    { id: "paystack-test-mode-payment", title: "Pay at checkout through Paystack test mode" },
    { id: "result-held-before-clinician-review", title: "An abnormal lab result is held: the patient cannot read it before a clinician releases it (INV-03)" },
    { id: "clinician-releases-result", title: "A clinician reviews and releases the held result; only then can the patient read it" },
    { id: "result-plain-language-explanation", title: "Results are explained in plain language (audio in English; Pidgin was removed)", pending: { owner: "S46", reason: "the plain-language explanation and Health Report are S46; no lab_result.released subscriber exists" } },
    { id: "daily-readings-graded", title: "She logs home blood pressure on several days; each reading is graded by the triage engine through the bus" },
    { id: "silence-nudge", title: "A silent week raises a re-engagement nudge", pending: { owner: "S26", reason: "silence.detected has no emitter and no subscriber (event map gap)" } },
    { id: "health-points-awarded", title: "Health Points are awarded for consistency", pending: { owner: "S58", reason: "Module 11 rewards are not built" } },
    { id: "care-pack-offer-above-target", title: "Average above target leads to the hypertension care pack offer", pending: { owner: "S61", reason: "condition pathway enrolment offers are S61/S62" } },
    { id: "son-joins-care-circle", title: "Her son joins her Care Circle through an invite (real sessions for both)" },
    { id: "son-pays-for-pack", title: "Her son pays for the pack with his card", pending: { owner: "S29", reason: "the gift flow exists but needs Paystack test keys and a served order-checkout function, which the local stack job does not have" } },
  ],
};

export const J2: JourneyDef = {
  id: "J2",
  title: "Journey 2: a red reading at night (full depth)",
  spec: "D.7.3 Journey 2",
  steps: [
    { id: "d1-rule-approved", title: "D1: the bp_care_triage rule set is approved by the real Chief Medical Officer" },
    { id: "rule-set-read-from-database", title: "The rule set the grade uses is read from the database (nothing is hard-coded)" },
    { id: "patient-logs-reading-with-symptom", title: "At 2 am a patient logs a very high reading with an emergency symptom (real browser, real session)" },
    { id: "guidance-shown-online", title: "Emergency guidance is shown to the patient after the reading is saved" },
    { id: "guidance-with-network-off-device", title: "Offline: the on-device engine grades red and the bundled guidance applies with no network (INV-06)" },
    { id: "guidance-with-network-off-web", title: "Offline on the web: guidance appears with the network off", pending: { owner: "S12 web follow-up", reason: "the web app has no offline emergency guidance: offline the form only refuses to save (INV-06 is met on the phone only)" } },
    { id: "offline-web-refuses-to-claim-saved", title: "Offline on the web: the form refuses and does not claim the reading was saved" },
    { id: "grade-from-rule-set", title: "The stored grade equals what the engine gives on the same facts with the rule set in the database" },
    { id: "no-model-call", title: "No language model call: none on the bus hosts, none in the governed AI log, none imported in the triage path (INV-01)" },
    { id: "queue-item-created", title: "A clinical task is created in the queue from the grade (approved rule set only)" },
    { id: "on-call-page-created", title: "The on-call clinician is paged (approved rule set only, INV-05)" },
    { id: "care-circle-contact-notified", title: "The consented Care Circle contact receives a neutral push and in-app alert (S29)" },
    { id: "notifications-neutral", title: "No notification names a condition or a reading (INV-07)" },
    { id: "clinician-acknowledges-and-records", title: "The paged clinician acknowledges and records the decision (real clinician session)" },
    { id: "audit-rows-written", title: "Audit rows exist for the reading, the grade, the page and the clinician's chart read (INV-10)" },
    { id: "followup-task-created", title: "A follow-up task is created" },
    { id: "followup-consult-booked", title: "The next day a follow-up consultation is booked automatically", pending: { owner: "S64", reason: "automatic follow-up booking after a red event is not built; consultation booking is S64" } },
    { id: "outcomes-engine-logs-event", title: "The outcomes engine logs the event", pending: { owner: "S38", reason: "S38 (outcome snapshots) is on its own branch and this journey does not log red events to it yet" } },
  ],
};

export const J3: JourneyDef = {
  id: "J3",
  title: "Journey 3: from symptom to treatment (typed skeleton)",
  spec: "D.7.3 Journey 3",
  steps: [
    { id: "symptom-checker-opens", title: "A user with burning urination opens the symptom checker", pending: { owner: "S59", reason: "symptom checker module is not built" } },
    { id: "structured-questions", title: "It asks structured questions", pending: { owner: "S59", reason: "symptom checker module is not built" } },
    { id: "likely-causes-with-frequency", title: "It suggests the most likely causes in plain language with how common each is", pending: { owner: "S59", reason: "symptom checker module is not built" } },
    { id: "urgency-see-doctor-24h", title: "It grades urgency as 'see a doctor within 24 hours' deterministically", pending: { owner: "S60", reason: "symptom checker safety rules are S60" } },
    { id: "offers-async-consultation", title: "It offers an asynchronous consultation", pending: { owner: "S64", reason: "consultation directory and async booking are S64" } },
    { id: "doctor-sees-symptom-summary", title: "The doctor sees the symptom summary", pending: { owner: "S64", reason: "no symptom summary is handed to a consultation yet" } },
    { id: "doctor-confirms-likely-uti", title: "The doctor confirms a likely urinary infection", pending: { owner: "S64", reason: "depends on the consultation flow in S64" } },
    { id: "urine-test-at-partner-lab", title: "The doctor requests a urine test at a partner lab", pending: { owner: "S64", reason: "request from a consultation is not wired (lab orders exist from S27)" } },
    { id: "prescription-to-partner-pharmacy", title: "The prescription goes to the user's chosen partner pharmacy for collection", pending: { owner: "S54", reason: "choice of pharmacy and the consultation link are S54 (dispensing exists from S28)" } },
    { id: "course-added-to-medicine-schedule", title: "The course is added to the medicine schedule", pending: { owner: "S53", reason: "medicine schedule and adherence are S53" } },
    { id: "assistant-checks-in-day-three", title: "The assistant checks in on day three", pending: { owner: "S51", reason: "the AI health assistant check-ins are S51/S52" } },
    { id: "monthly-accuracy-audit", title: "The suggestion and the doctor's diagnosis are compared in the monthly accuracy audit", pending: { owner: "S60", reason: "the accuracy audit for symptom suggestions is S60 (S38e covers triage grades only)" } },
  ],
};

export const J4: JourneyDef = {
  id: "J4",
  title: "Journey 4: an employer programme (privacy property test)",
  spec: "D.7.3 Journey 4",
  steps: [
    { id: "institution-and-cohort-created", title: "An employer organisation and a cohort code are created through the admin RPC (real admin session)" },
    { id: "enrol-300-by-cohort-code", title: "300 staff join by the cohort code (join_cohort RPC, simulated authenticated sessions for volume)" },
    { id: "institution-console-redemption", title: "Staff redeem the code in the institution console", pending: { owner: "S79", reason: "the institution console is not built (the RPC exists from S38e)" } },
    { id: "sponsored-packs-as-entitlements", title: "Staff get sponsored care packs and consultations as entitlements", pending: { owner: "S79", reason: "sponsored entitlements through the institution console are S79" } },
    { id: "institution-reads-no-patient-rows", title: "A real institution session reads zero rows from every patient table, with a control that the rows exist" },
    { id: "institution-view-aggregates-only", title: "The institution's own view returns aggregates only: no ids, no names, no lists" },
    { id: "small-cells-suppressed", title: "A cohort below the minimum cell is withheld whole, and a cut that would expose a small cell is suppressed" },
    { id: "aggregate-figures-over-300-people", title: "A real aggregate figure is produced over the 300 (rates, counts) and still carries no individual" },
    { id: "no-reproductive-or-mental-health", title: "No reproductive health or mental health figure or row reaches the institution, though such rows exist" },
    { id: "clinician-without-tie-reads-nothing", title: "A real clinician session with no task, lead or page reads none of the cohort's records (INV-12)" },
    { id: "patient-reads-own-control", title: "Control: a real patient session reads their own rows, so empty results elsewhere are not an empty fixture" },
  ],
};

export const JOURNEYS: Readonly<Record<JourneyId, JourneyDef>> = { J1, J2, J3, J4 };

/** Start a run with every known-pending step already resolved as pending. */
export function startJourney(def: JourneyDef): JourneyRun {
  const run = new JourneyRun(def.id, def.title, def.steps.map((s) => ({ id: s.id, title: s.title })));
  for (const s of def.steps) if (s.pending) run.pending(s.id, s.pending.owner, s.pending.reason);
  return run;
}

export function knownPendingCount(def: JourneyDef): number {
  return def.steps.filter((s) => s.pending).length;
}
