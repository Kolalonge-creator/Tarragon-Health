import type { CoachChatMessage } from "@tarragon/shared";

/**
 * S52 (spec 7.11): ask a short follow-up BEFORE answering when a message is too unclear to answer safely. Deterministic: the same
 * message always gets the same questions, so it can be evaluated with fixed cases (clarify.eval.test.ts) and never costs a model call.
 *
 * Rules that keep it kind, short and safe:
 *  - it runs only after the red-flag, sensitive-result and dose screens, so an emergency is never delayed by a question;
 *  - at most TWO questions, in one reply, and never twice in a row: if either of the last two assistant turns was a clarification, the
 *    patient is answered with what they have (the model then does its best and says what it does not know);
 *  - only short messages (it is the vague one-liners that need a question, not a long, specific message);
 *  - a reply to our own question is never questioned again.
 */
export const CLARIFY_LEAD_IN = "Just so I can help properly:";

export interface Clarification {
  topic: "symptom" | "medicine" | "reading" | "reassurance";
  questions: string[];
  reply: string;
}

const BODY_PART = /\b(head|chest|stomach|belly|abdomen|back|neck|throat|ear|eye|eyes|tooth|teeth|leg|legs|arm|arms|foot|feet|knee|hip|shoulder|skin|hand|hands|joint|joints|heart|bladder|urine|bowel)\b/i;
const DURATION = /\b((?:\d+|one|two|three|four|five|six|seven|a few|several)\s*(?:day|days|week|weeks|month|months|hour|hours)|since\b|yesterday|today|this morning|last night|for a while|started|began)\b/i;
const GREETING_OR_ANSWER = /^(?:hi|hello|hey|thanks|thank you|ok|okay|yes|no|yeah|nope|sure|good morning|good evening|please)\b/i;

const VAGUE_SYMPTOM = /\b(?:it|this|that)\s+(?:hurts|is hurting|is painful|feels (?:bad|wrong|off|strange|funny|odd))\b|\bi (?:don'?t|do not) feel (?:well|good|right)\b|\bi feel (?:sick|unwell|bad|off|funny|strange|weak)\b|\bnot feeling (?:well|good|right)\b/i;
const GENERIC_MEDICINE = /\b(?:my|the) (?:medicine|medicines|medication|medications|tablet|tablets|pill|pills|drug|drugs)\b/i;
const MEDICINE_QUESTION = /\b(?:is it|is that|safe|ok|okay|side effects?|what (?:is|does)|how long|when should|work|working)\b/i;
const GENERIC_REASSURANCE = /^(?:is|are) (?:it|that|this|they) (?:normal|ok|okay|bad|fine|serious|safe)\??$|^(?:should i|do i need to) (?:worry|be worried|be concerned)\??$|^what (?:does|do) (?:it|that|this) mean\??$/i;
const GENERIC_READING = /\b(?:my|the) (?:result|results|reading|readings|numbers?|test|tests|scan)\b/i;
const READING_QUESTION = /\b(?:mean|means|ok|okay|normal|bad|good|high|low|wrong|explain)\b/i;
const NAMED_READING = /\b(?:hba1c|a1c|glucose|sugar|cholesterol|bp|blood pressure|creatinine|potassium|sodium|weight|pulse|oxygen|spo2|temperature|ldl|hdl|triglycerides?)\b/i;

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function lastAssistantTurns(prior: readonly CoachChatMessage[], n: number): CoachChatMessage[] {
  return prior.filter((m) => m.role === "assistant").slice(-n);
}

export function decideClarification(input: { message: string; priorMessages: readonly CoachChatMessage[] }): Clarification | null {
  const message = input.message.trim();
  if (!message || words(message) > 10 || message.length > 90) return null;
  if (GREETING_OR_ANSWER.test(message)) return null;

  const recent = lastAssistantTurns(input.priorMessages, 2);
  // never twice in a row, and never question an answer to our own question
  if (recent.some((m) => m.content.startsWith(CLARIFY_LEAD_IN))) return null;
  const last = recent[recent.length - 1];
  if (last && /\?\s*$/.test(last.content.trim())) return null;

  const lead = (qs: string[], topic: Clarification["topic"]): Clarification => ({
    topic,
    questions: qs.slice(0, 2),
    reply: `${CLARIFY_LEAD_IN} ${qs.slice(0, 2).join(" ")}`,
  });

  if (VAGUE_SYMPTOM.test(message) && !BODY_PART.test(message) && !DURATION.test(message)) {
    return lead(["Where do you feel it?", "When did it start?"], "symptom");
  }
  if (GENERIC_MEDICINE.test(message) && MEDICINE_QUESTION.test(message) && !/\b[A-Z][a-z]{4,}\b/.test(message.replace(/^\w+\s/, ""))) {
    return lead(["Which medicine do you mean?", "What would you like to know about it?"], "medicine");
  }
  if (GENERIC_READING.test(message) && READING_QUESTION.test(message) && !NAMED_READING.test(message)) {
    return lead(["Which result or reading do you mean?", "What would you like to know about it?"], "reading");
  }
  if (GENERIC_REASSURANCE.test(message)) {
    return lead(["What are you asking about?", "For example a reading, a symptom or a medicine."], "reassurance");
  }
  return null;
}
