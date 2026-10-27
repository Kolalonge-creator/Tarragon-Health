/**
 * Words for the Care Circle presets, the plain-language preview, the "waiting for them" state, shared jobs, the weekly digest and the
 * gentle nudge (S69b, docs/design/S69b-care-circle.md). English only (decision D-14).
 *
 * EVERY STRING IN THIS FILE IS PROPOSED COPY AWAITING CMO AND DPO REVIEW (OQ-S69b-1). The preview lines are consent wording: they are the
 * words a person reads before they agree to share or to receive. They sit under the `cctools.` prefix, not `circle.`, so the
 * reviewed-strings ledger (whose baseline can only shrink) does not have to grow; CIRCLE_TOOLS_COPY_REVIEW below is the marker, a test
 * fails if a key is missing from the catalogue, and nobody but the CMO marks anything reviewed. This file never does.
 *
 * Rules held by tests: no em dashes; "your care team", never "your doctor"; no condition named; the preview never promises more than
 * the permissions allow (the codes come from @tarragon/shared previewForPermissions); the word "declined" is never shown to a sender.
 */

/** The codes @tarragon/shared previewForPermissions returns (declared here because this package does not depend on shared; a test in the web app keeps them equal). */
export type CircleSeesCode = "adherence" | "bp" | "appointments" | "digest";
export type CircleCanCode = "alert" | "pay" | "tasks" | "call";

export const circleToolsCopy = {
  // --- presets
  "cctools.preset.legend": "What can this person do?",
  "cctools.preset.see.title": "Can see",
  "cctools.preset.see.body": "They can see how things are going and be asked to check on you. They cannot pay or take on jobs.",
  "cctools.preset.help.title": "Can see and help",
  "cctools.preset.help.body": "Everything in Can see, and they can also pay for your care and take on small jobs you share, like a lift to the lab.",
  "cctools.preset.custom.title": "Choose one by one",
  "cctools.preset.custom.body": "Tick exactly what you want below.",

  // --- the plain-language preview, before anything is sent and again before anyone accepts
  "cctools.preview.title.sender": "What this person will see and do",
  "cctools.preview.title.invitee": "What you will be able to see and do",
  "cctools.preview.sees": "They will see",
  "cctools.preview.sees.invitee": "You will see",
  "cctools.preview.can": "They will be able to",
  "cctools.preview.can.invitee": "You will be able to",
  "cctools.preview.sees.adherence": "Whether medicines were taken, as a count for the week. Never which medicines.",
  "cctools.preview.sees.bp": "A weekly blood pressure trend, as averages only. Never a single reading.",
  "cctools.preview.sees.appointments": "The next appointment, and whether any were missed. Never the reason.",
  "cctools.preview.sees.digest": "A short weekly note, for example how many days readings were logged.",
  "cctools.preview.can.alert": "Be asked to check in when your care team sees something urgent. They see only a name, never what happened.",
  "cctools.preview.can.pay": "Pay for care. Paying shows no health information.",
  "cctools.preview.can.tasks": "Take on small shared jobs, like a lift to the lab or collecting medicines.",
  "cctools.preview.can.call": "Be invited to join a call, one call at a time.",
  "cctools.preview.never": "Never shared: single readings, medicine names, results, notes or messages.",
  "cctools.preview.control.sender": "You can stop sharing at any time, and you can always see who looked.",
  "cctools.preview.control.invitee": "{name} can stop sharing at any time, and can see each time you look.",
  "cctools.preview.none": "Nothing is shared yet. Choose what they can do.",
  "cctools.preview.cross_org": "Because your account is with a different organisation, some options are not available to you.",

  // --- the sender's list: neutral, never says declined
  "cctools.invite.waiting": "Waiting for them",
  "cctools.invite.waiting_help": "Their name appears here when they join. The link works until {date}.",

  // --- the join screen
  "cctools.join.not_now": "Not now",
  "cctools.join.not_now_done": "Okay. Nothing has been shared with you. Ask for a new link any time.",
  "cctools.join.not_now_error": "We could not do that just now. Please try again.",

  // --- the patient's switch for the gentle nudge
  "cctools.nudge.label": "Send {name} a gentle nudge if a dose has had no answer for a while",
  "cctools.nudge.help": "After about {minutes} minutes with no answer, {name} gets a short note that says nothing about medicines. It is never used for an urgent event, which reaches your circle straight away.",
  "cctools.nudge.needs_adherence": "Share the medicines count with {name} first to use this.",
  "cctools.nudge.error": "We could not save that. Please try again.",

  // --- supporter: the nudge list
  "cctools.nudges.title": "A friendly call may help",
  "cctools.nudges.line": "{name} may like to hear from you.",

  // --- supporter: the weekly digest
  "cctools.digest.title": "This week",
  "cctools.digest.note": "A short note built only from what {name} chose to share.",
  "cctools.digest.doses": "{name} took all their medicines on {done} of {total} days.",
  "cctools.digest.readings": "{name} logged readings on {days} of {span} days.",
  "cctools.digest.next_appointment": "Next appointment: {date}",
  "cctools.digest.tasks": "Shared jobs: {open} to claim, {claimed} taken on, {done} done.",
  "cctools.digest.empty": "Nothing to show this week.",

  // --- shared jobs
  "cctools.tasks.title": "Shared jobs",
  "cctools.tasks.intro": "Small jobs the circle can take on. There is no chat here and nothing is typed in.",
  "cctools.tasks.empty": "No jobs right now.",
  "cctools.tasks.view_only": "You can see these jobs. Taking one on needs the Can see and help setting.",
  "cctools.tasks.add": "Add a job",
  "cctools.tasks.kind": "What is it?",
  "cctools.tasks.date": "Needed by (optional)",
  "cctools.tasks.post": "Add job",
  "cctools.tasks.claim": "I will do this",
  "cctools.tasks.release": "I cannot do it now",
  "cctools.tasks.complete": "Mark done",
  "cctools.tasks.cancel": "Remove",
  "cctools.tasks.state.open": "Open",
  "cctools.tasks.state.claimed_other": "{name} will do this",
  "cctools.tasks.state.claimed_mine": "You will do this",
  "cctools.tasks.state.done": "Done",
  "cctools.tasks.needed_by": "Needed by {date}",
  "cctools.tasks.taken": "Someone already took this one.",
  "cctools.tasks.limit": "There are already as many open jobs as allowed. Finish or remove one first.",
  "cctools.tasks.error": "We could not do that just now. Please try again.",
  "cctools.task.kind.take_to_appointment": "A lift to an appointment",
  "cctools.task.kind.take_to_lab": "A lift to the lab",
  "cctools.task.kind.collect_medicines": "Collect medicines",
  "cctools.task.kind.visit": "A visit",
  "cctools.task.kind.phone_call": "A phone call",
  "cctools.task.kind.errand": "An errand",
} as const;

export type CircleToolsCopyKey = keyof typeof circleToolsCopy;

export const CIRCLE_TOOLS_COPY_REVIEW = {
  status: "pending_cmo_review",
  owner: "CMO",
  also: "DPO (consent wording)",
  source: "docs/design/S69b-care-circle.md",
  prefixes: ["cctools."],
} as const;

const SEES_KEYS: Readonly<Record<CircleSeesCode, CircleToolsCopyKey>> = {
  adherence: "cctools.preview.sees.adherence",
  bp: "cctools.preview.sees.bp",
  appointments: "cctools.preview.sees.appointments",
  digest: "cctools.preview.sees.digest",
};
const CAN_KEYS: Readonly<Record<CircleCanCode, CircleToolsCopyKey>> = {
  alert: "cctools.preview.can.alert",
  pay: "cctools.preview.can.pay",
  tasks: "cctools.preview.can.tasks",
  call: "cctools.preview.can.call",
};
const TASK_KIND_KEYS: Readonly<Record<string, CircleToolsCopyKey>> = {
  take_to_appointment: "cctools.task.kind.take_to_appointment",
  take_to_lab: "cctools.task.kind.take_to_lab",
  collect_medicines: "cctools.task.kind.collect_medicines",
  visit: "cctools.task.kind.visit",
  phone_call: "cctools.task.kind.phone_call",
  errand: "cctools.task.kind.errand",
};

export const circleToolsSeesKey = (code: CircleSeesCode): CircleToolsCopyKey => SEES_KEYS[code];
export const circleToolsCanKey = (code: CircleCanCode): CircleToolsCopyKey => CAN_KEYS[code];
/** An unknown kind (a newer server than this app) reads as a plain errand rather than a blank row. */
export const circleToolsTaskKindKey = (kind: string): CircleToolsCopyKey => TASK_KIND_KEYS[kind] ?? "cctools.task.kind.errand";
