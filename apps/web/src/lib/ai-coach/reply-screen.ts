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

const SENSITIVE_TERM = /\b(?:hiv|aids|hbsag|hbs\s*ag|hcv|hbv|hepatitis\s*[bc]|hep\s*[bc]|anti[\s-]?hcv|surface antigen)\b/i;
const RESULT_WORD = /\b(?:result|results|test|tests|tested|positive|reactive|status|screen|screening|came back|report|reading|detected|viral load|cd4)\b/i;
const POSITIVE_WORD = /\b(?:positive|reactive|detected|infected|have|has|living with)\b/i;

/** True when the patient's own message asks about a screening result of this kind. Fail safe: a term plus any result word. */
export function screenSensitiveResultQuestion(message: string): boolean {
  return SENSITIVE_TERM.test(message) && RESULT_WORD.test(message);
}

/** True when a drafted reply names such a result as positive or reactive (or discusses one at all in result terms). */
export function screenSensitiveResultReply(reply: string): boolean {
  return SENSITIVE_TERM.test(reply) && RESULT_WORD.test(reply) && POSITIVE_WORD.test(reply);
}
