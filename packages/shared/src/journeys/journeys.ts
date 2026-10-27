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
    { id: "goal-blood-pressure", title: "Onboarding records her own goal and condition choice (manage a condition, hypertension) in onboarding_answers, through her real session" },
    { id: "risk-questionnaire-high-cv-risk", title: "Risk questionnaire places her at high cardiovascular risk", pending: { owner: "CMO signs the WHO CVD risk instrument", reason: "S45 built the questionnaire engine and the instrument table, but the WHO CVD instrument is unsigned and off (risk_instrument_versions needs sign_risk_instrument by the Chief Medical Officer), so no risk band is placed" } },
    { id: "screening-calendar-essential-due", title: "Screening calendar shows the Essential screen due", pending: { owner: "CMO signs the screening rules", reason: "S45 built the calendar, but nothing is scheduled until the CMO signs screening_rule_sets (v1 is PROPOSED and unsigned; private.screening_rules_signed() is false)" } },
    { id: "order-created-for-screen", title: "Create an order for the paid product (the membership) as the patient (real session, pending payment)" },
    { id: "paystack-test-mode-payment", title: "Pay at checkout through Paystack test mode" },
    { id: "result-held-before-clinician-review", title: "An abnormal lab result is held: the patient cannot read it before a clinician releases it (INV-03)" },
    { id: "clinician-releases-result", title: "A clinician reviews and releases the held result; only then can the patient read it" },
    { id: "result-plain-language-explanation", title: "Results are explained in plain language (English text; the audio half was dropped by founder decision R1, and Pidgin by D-14)", pending: { owner: "FOUNDER decides what this step now means", reason: "S46 built deterministic plain-language guidance and a signed-only Health Report, whose settings are unsigned; the step as written asks for audio, which was dropped, so it needs rewording before it can be asserted" } },
    { id: "daily-readings-graded", title: "She logs home blood pressure on several days; each reading is graded by the triage engine through the bus" },
    { id: "silence-nudge", title: "A silent week raises a re-engagement nudge", pending: { owner: "CMO confirms the silence sweep", reason: "P6 emits silence.detected (BP-A5, days read from the rule set) and a subscriber grades it, but the daily sweep is born off (triage_coverage_config.enabled = false) and a draft rule set only produces shadow results; switching either on is a human decision" } },
    { id: "health-points-awarded", title: "Health Points are awarded for logging readings (a capped amount a day, never for what a reading says) through the bus" },
    { id: "care-pack-offer-above-target", title: "Average above target leads to the hypertension care pack offer", pending: { owner: "S61", reason: "S61/S62 built the pathway engine, but no code makes an enrolment offer from a seven day average above target" } },
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
    { id: "guidance-with-network-off-web", title: "Offline on the web: the emergency guidance appears from bundled code with the network off, at least as strong as the server's grade (INV-06)" },
    { id: "offline-web-refuses-to-claim-saved", title: "Offline on the web: the form refuses and does not claim the reading was saved" },
    { id: "grade-from-rule-set", title: "The stored grade equals what the engine gives on the same facts with the rule set in the database" },
    { id: "no-model-call", title: "No language model call: none on the bus hosts, none in the governed AI log, none imported in the triage path (INV-01)" },
    { id: "queue-item-created", title: "Every create_task action of the approved rule has a task, and a red grade pages instead of waiting in the queue (INV-05)" },
    { id: "on-call-page-created", title: "The on-call clinician is paged (approved rule set only, INV-05)" },
    { id: "care-circle-contact-notified", title: "The consented Care Circle contact receives a neutral push and in-app alert (S29)" },
    { id: "notifications-neutral", title: "No notification names a condition or a reading (INV-07)" },
    { id: "clinician-acknowledges-and-records", title: "The paged clinician acknowledges and records the decision (real clinician session)" },
    { id: "audit-rows-written", title: "Audit rows exist for the reading, the grade, the page and the clinician's chart read (INV-10)" },
    { id: "followup-task-created", title: "A follow-up task is created" },
    { id: "followup-consult-booked", title: "The next day a follow-up consultation is booked automatically", pending: { owner: "S64", reason: "the approved rule set names no follow-up task or booking for a red reading (OQ-551), so nothing books one; consultation booking itself exists from S64" } },
    { id: "outcomes-engine-logs-event", title: "The outcomes engine logs the event", pending: { owner: "S38", reason: "S38 snapshots are daily programme windows and the S38c risk view counts red events from triage_events (red_events_30d); nothing writes an outcome record at red time, so there is no event to assert" } },
  ],
};

export const J3: JourneyDef = {
  id: "J3",
  title: "Journey 3: from symptom to treatment (typed skeleton)",
  spec: "D.7.3 Journey 3",
  steps: [
    { id: "symptom-checker-opens", title: "A user with burning urination opens the symptom checker", pending: { owner: "S59", reason: "the checker exists but is behind the symptom_checker_enabled go-live guard (off) and the seeded pathways are headache, chest pain and breathlessness only: there is no urinary complaint pathway" } },
    { id: "structured-questions", title: "It asks structured questions", pending: { owner: "S59", reason: "built for headache, chest pain and breathlessness only; a urinary complaint has no pathway, and the checker is behind its go-live guard" } },
    { id: "likely-causes-with-frequency", title: "It suggests the most likely causes in plain language with how common each is", pending: { owner: "FOUNDER decides whether causes are ever shown", reason: "by founder decision the checker returns no possible causes (the engine contract suite fails any result that carries possibleCauses), so this step as written cannot pass" } },
    { id: "urgency-see-doctor-24h", title: "It grades urgency as 'see a doctor within 24 hours' deterministically", pending: { owner: "CMO signs a urinary pathway", reason: "urgency is deterministic (S60) but needs a signed pathway for the complaint; none exists for burning urination and the draft protocols are unsigned" } },
    { id: "offers-async-consultation", title: "It offers an asynchronous consultation", pending: { owner: "S64", reason: "the written-question and consultation flows exist, but the checker does not run for this complaint, so it cannot offer one" } },
    { id: "doctor-sees-symptom-summary", title: "The doctor sees the symptom summary", pending: { owner: "S64", reason: "the summary hand-off exists (S59, refused while symptom_checker_enabled is closed) but there is no checker session for this complaint to hand off" } },
    { id: "doctor-confirms-likely-uti", title: "The doctor confirms a likely urinary infection", pending: { owner: "S64", reason: "depends on the consultation steps above" } },
    { id: "urine-test-at-partner-lab", title: "The doctor requests a urine test at a partner lab", pending: { owner: "S64", reason: "lab orders exist (S27) but a request from a consultation is not wired and no consultation step runs yet" } },
    { id: "prescription-to-partner-pharmacy", title: "The prescription goes to the user's chosen partner pharmacy for collection", pending: { owner: "S54", reason: "the chosen-pharmacy flow and dispensing exist (S28, S54) but need a signed prescription from the consultation steps above; the DB proofs cover the pieces separately" } },
    { id: "course-added-to-medicine-schedule", title: "The course is added to the medicine schedule", pending: { owner: "S53", reason: "the schedule and adherence engine exist (S53, S08) but the course follows a confirmed prescription, which the steps above do not produce yet" } },
    { id: "assistant-checks-in-day-three", title: "The assistant checks in on day three", pending: { owner: "S51", reason: "S51 sends one daily nudge from keyed templates, but no rule creates a day three check-in from a prescription or consultation, and the assistant is behind its go-live guard" } },
    { id: "monthly-accuracy-audit", title: "The suggestion and the doctor's diagnosis are compared in the monthly accuracy audit", pending: { owner: "S60", reason: "no suggestion with causes is stored (see likely-causes-with-frequency); S60 symptom reviews and S38e triage agreement are different measures" } },
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
