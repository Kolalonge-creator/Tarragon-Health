/**
 * The wording the CMO signs for the bounded disclosure fallback (S27h). The words are fixed here, linted for neutrality (INV-07, the
 * s22 template test) and signed by NUMBER: the signature row in the database holds `wording_key`, never the text, so nobody can
 * change what is sent without changing this file, which the test pins to the notice the patient actually sees.
 *
 * What the message is for: a held sensitive result whose disclosure attempts are used up and whose CMO escalation has waited the
 * configured time. The patient hears only that the care team wants to speak with them and how to reach it. It names no test, no
 * value, no condition. It NEVER releases the result: the value stays held until a clinician has told the patient in person.
 */
export const LAB_FALLBACK_WORDING = {
  v1: "Your care team would like to speak with you. Please open the app and send them a message when you can",
} as const;

export type LabFallbackWordingKey = keyof typeof LAB_FALLBACK_WORDING;
