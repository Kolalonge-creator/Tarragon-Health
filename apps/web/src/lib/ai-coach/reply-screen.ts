/**
 * Deterministic screens around the model (no model call, no database).
 *
 * 1. INV-04: the assistant never discusses a screening result for HIV, hepatitis B surface antigen or hepatitis C antibody.
 *    - `screenSensitiveResultQuestion` runs on the patient's message BEFORE any model call. A question about such a result
 *      is answered with fixed copy that routes to the care team; the model is never reached.
 *    - `screenSensitiveResultReply` runs on the model's reply AFTER it is written. If the reply names such a result as
 *      positive or reactive, it is replaced with the same fixed copy.
 *    The data is also excluded at the source (ai_readable_lab_readings view), so these screens are the second and third layer.
 *
 * Fixed copy is hand-written. No em dashes. It says "your care team".
 */

export const SENSITIVE_RESULT_REPLY =
  "I can't go through this kind of test result in chat. It is something your care team talks through with you privately, in person or on a call. Please send them a message in the app and they will arrange it. If you feel unwell or unsafe right now, go to the nearest hospital.";

const SENSITIVE_TERM = /\b(?:hiv|(?<!hearing\s)(?<!band[-\s])aids|hbsag|hbs\s*ag|hcv|hbv|hepatitis\s*[bc]|hep\s*[bc]|anti[\s-]?hcv|surface antigen)\b/i;
const RESULT_WORD = /\b(?:result|results|test|tests|tested|positive|reactive|status|screen|screening|came back|report|reading|detected|viral load|cd4)\b/i;
const POSITIVE_WORD = /\b(?:positive|reactive|detected|infected|have|has|living with)\b/i;

/** True when any text names an HIV, hepatitis B or hepatitis C screening subject at all. Used to keep such text out of the model's hands. */
export function mentionsSensitiveScreening(text: string): boolean {
  return SENSITIVE_TERM.test(text);
}

/** True when the patient's own message asks about a screening result of this kind. Fail safe: a term plus any result word. */
export function screenSensitiveResultQuestion(message: string): boolean {
  return SENSITIVE_TERM.test(message) && RESULT_WORD.test(message);
}

/** True when a drafted reply names such a result as positive or reactive (or discusses one at all in result terms). */
export function screenSensitiveResultReply(reply: string): boolean {
  return SENSITIVE_TERM.test(reply) && RESULT_WORD.test(reply) && POSITIVE_WORD.test(reply);
}

// ---------------------------------------------------------------------------------------------------------------------------
// 2. Dose and medicine-change screen (S51, spec 7.4: "never dose changes"). Deterministic, in code, not only in the prompt.
// ---------------------------------------------------------------------------------------------------------------------------

export const DOSE_REFUSAL_REPLY =
  "I can't change or advise on the amount or timing of any medicine, and I can't tell you to stop one. That decision belongs to your care team, who know your full picture. Please send them a message in the app and they will look at it with you. Until then, keep taking your medicines the way they were prescribed.";

const MED_NOUN = String.raw`(?:dose|doses|dosage|tablet|tablets|pill|pills|medicine|medicines|medication|medications|meds|insulin|injection|injections|drug|drugs|capsule|capsules|prescription)`;
// Verbs that only ever mean "change a medicine" next to a medicine noun. The vaguer ones (reduce, lower, raise, cut, change, adjust, swap,
// switch) are used for diet and lifestyle all day ("reduce my blood sugar without medication"), so they count ONLY next to dose/dosage.
const CHANGE_VERB = String.raw`(?:increase|increasing|decrease|decreasing|double|doubling|halve|halving|stop(?!\s+(?:thinking|worrying|forgetting))|stopping|skip|skipping|quit|quitting|come off|coming off)`;
// The same, said about something that has ALREADY happened ("I stopped my tablets", "I doubled my dose"). A patient who has changed a medicine
// on their own is the most important adherence and safety signal there is: the same refusal, the same route to the care team, and the same
// clinician flag as a request. Request-side only: a drafted REPLY restating the record ("you stopped...") is not screened with these.
const PAST_CHANGE_VERB = String.raw`(?:increased|decreased|doubled|halved|stopped|skipped|quit|came off|not taking|haven'?t (?:been )?taking|haven'?t taken|have not (?:been )?(?:taking|taken))`;
const DOSE_NOUN = String.raw`(?:dose|doses|dosage)`;
const VAGUE_VERB = String.raw`(?:reduce|reducing|lower|lowering|raise|raising|cut|cutting|change|changing|adjust|adjusting|swap|switch|switching)`;
const MORE_LESS = String.raw`(?:more|less|extra|double|another|half|two)`;

/** A request to CHANGE a medicine. Also opens a clinician flag, because stopping or doubling is an adherence and safety signal. */
const CHANGE_PATTERNS: RegExp[] = [
  new RegExp(String.raw`\b${CHANGE_VERB}\b.{0,40}\b${MED_NOUN}\b`, "i"),
  new RegExp(String.raw`\b${MED_NOUN}\b.{0,40}\b${CHANGE_VERB}\b`, "i"),
  new RegExp(String.raw`\b${PAST_CHANGE_VERB}\b.{0,40}\b${MED_NOUN}\b`, "i"),
  new RegExp(String.raw`\b${MED_NOUN}\b.{0,40}\b${PAST_CHANGE_VERB}\b`, "i"),
  new RegExp(String.raw`\b${VAGUE_VERB}\b.{0,40}\b${DOSE_NOUN}\b`, "i"),
  new RegExp(String.raw`\b${DOSE_NOUN}\b.{0,40}\b${VAGUE_VERB}\b`, "i"),
  new RegExp(String.raw`\btake\s+${MORE_LESS}\s+(?:(?:a|an|the|my|your|of)\s+)*${MED_NOUN}\b`, "i"),
  new RegExp(String.raw`\b(?:should|can|may|could) i (?:double|halve|skip)\b`, "i"),
];

/** A question that asks the assistant to name an amount. Refused the same way, but no clinician flag: it is not a change. */
const AMOUNT_QUESTION_PATTERNS: RegExp[] = [/\bhow much\b.{0,40}\b(?:should i take|do i take|to take)\b/i];

export type DoseRequestKind = "none" | "change" | "amount_question";

export function classifyDoseRequest(message: string): DoseRequestKind {
  if (CHANGE_PATTERNS.some((re) => re.test(message))) return "change";
  if (AMOUNT_QUESTION_PATTERNS.some((re) => re.test(message))) return "amount_question";
  return "none";
}

/** True when the patient asks to change, skip, stop or double a medicine or dose, or for an amount. Fail safe: over-matching routes to the care team. */
export function screenDoseChangeRequest(message: string): boolean {
  return classifyDoseRequest(message) !== "none";
}

const RECOMMEND = String.raw`(?:should|could|can|might|try|start|begin|consider|suggest|recommend|need to|ought to|better to|advise|go up to|go down to|move to)`;
const DOSE_NUMBER = String.raw`\d+(?:[.,]\d+)?\s?(?:mg|mcg|µg|g|ml|iu|units?|tablets?|pills?|capsules?|puffs?)`;
const REPLY_PATTERNS: RegExp[] = [
  // a recommendation tied to a dose number
  new RegExp(String.raw`\b${RECOMMEND}\b[^.!?;\n]{0,60}${DOSE_NUMBER}`, "i"),
  new RegExp(String.raw`${DOSE_NUMBER}[^.!?;\n]{0,40}\b${RECOMMEND}\b`, "i"),
  // a change verb aimed at a medicine in the second person
  new RegExp(String.raw`\byou\b[^.!?;\n]{0,30}\b${CHANGE_VERB}\b[^.!?;\n]{0,40}\b${MED_NOUN}\b`, "i"),
  new RegExp(String.raw`\b(?:increase|increasing|reduce|double|halve|stop|skip|raise|lower)\b[^.!?;\n]{0,25}\b(?:your|the|this|that)\b[^.!?;\n]{0,20}\b${MED_NOUN}\b`, "i"),
  new RegExp(String.raw`\btake\s+(?:an?\s+)?${MORE_LESS}\s+(?:(?:a|an|the|my|your|of)\s+)*${MED_NOUN}\b`, "i"),
  /\b(?:safe|fine|okay|ok) to (?:stop|skip|double|halve|take more)\b/i,
];

/** "Do not stop it", "never double up": a sentence that says NOT to change something is the opposite of advice to change it. */
const NEGATED = /\b(?:don'?t|do not|never|not|no need to|without)\b[^.!?;\n]{0,20}\b(?:stop|skip|double|halve|increase|reduce|take more|take extra|change)\b/i;
/** A sentence that only points to the care team or the pharmacist, with no dose number to recommend. */
const ROUTING = /\b(?:ask|tell|talk to|speak to|check with|message|contact|discuss with)\b[^.!?;\n]{0,50}\b(?:care team|pharmacist|doctor|clinician)\b/i;

function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?;])\s+|\n+/).filter((x) => x.trim().length > 0);
}

/** True when a drafted reply proposes a dose, an increase, a stop or a double. Sentence by sentence; a plain restatement of the record,
 *  a "do not stop it" and a pointer to the care team all pass. */
export function screenDoseAdvice(reply: string): boolean {
  return sentencesOf(reply).some((sentence) => {
    if (!REPLY_PATTERNS.some((re) => re.test(sentence))) return false;
    const hasDoseNumberAdvice =
      new RegExp(String.raw`\b${RECOMMEND}\b[^.!?;\n]{0,60}${DOSE_NUMBER}`, "i").test(sentence) ||
      new RegExp(String.raw`${DOSE_NUMBER}[^.!?;\n]{0,40}\b${RECOMMEND}\b`, "i").test(sentence);
    if (!hasDoseNumberAdvice && (NEGATED.test(sentence) || ROUTING.test(sentence))) return false;
    return true;
  });
}
