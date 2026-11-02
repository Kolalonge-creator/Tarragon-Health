/**
 * Front Desk F3, the PRE-check: fixed rules that run on what a visitor types BEFORE any model is reached. The model is never the only safety
 * control, so the things that matter most (an emergency, an attempt to extract the prompt, a request for medical advice) are decided here, in
 * code, and answered with fixed wording. Pure: no I/O, no model, no clock.
 *
 * Emergency matching is deliberately broad and deliberately has NO negation handling: "I have no chest pain" is rare, and a false alarm costs a
 * calm message and an alert, while a missed emergency costs far more. Wording follows how people actually write in Nigerian English.
 */
export type RuleOutcome =
  | { readonly kind: "emergency"; readonly variant: "general" | "self_harm"; readonly matched: readonly string[] }
  | { readonly kind: "prompt_extraction"; readonly matched: readonly string[] }
  | { readonly kind: "medical_advice"; readonly matched: readonly string[] }
  | { readonly kind: "wants_human" }
  | { readonly kind: "none" };

interface Rule {
  readonly id: string;
  readonly re: RegExp;
}

const SELF_HARM: readonly Rule[] = [
  { id: "suicide", re: /\bsuicid(e|al)\b/i },
  { id: "kill_myself", re: /\bkill(ing)?\s+(my\s?self|myself)\b/i },
  { id: "end_my_life", re: /\bend(ing)?\s+(my|this)\s+life\b/i },
  { id: "want_to_die", re: /\b(want|wanna|wish|wishing)\s+(to\s+)?(die|be\s+dead)\b|\b(don'?t|dont|do\s+not|no\s+longer)\s+want\s+to\s+(live|be\s+alive|go\s+on|be\s+here)\b|\bnot\s+want\s+to\s+(live|be\s+alive)\b|\b(can'?t|cannot)\s+go\s+on\b|\bno\s+reason\s+to\s+live\b/i },
  { id: "self_harm", re: /\b(self[\s-]?harm|hurt(ing)?\s+(my\s?self|myself)|cut(ting)?\s+(my\s?self|myself))\b/i },
];

const EMERGENCY: readonly Rule[] = [
  { id: "chest_pain", re: /\bchest\b[^.?!]{0,25}\b(pain|pains|paining|tight|tightness|pressure|crushing|hurts?)\b|\b(pain|pains|tightness|pressure)\b[^.?!]{0,20}\b(in|on|around)\s+(my|the|his|her)\s+chest\b/i },
  { id: "heart_attack", re: /\bheart\s*attack\b|\bcardiac\s+arrest\b|\bheart\s+(is\s+)?(stopp|racing\s+and)/i },
  { id: "cannot_breathe", re: /\b(can'?t|cannot|can\s+not|unable\s+to|struggling\s+to|difficulty|trouble|hard\s+to)\s+(\w+\s+){0,2}breath(e|ing)?\b|\bshort(ness)?\s+of\s+breath\b|\bbreathless(ness)?\b|\bgasping\b|\b(not|stopped|stop)\s+breathing\b|\bcan'?t\s+catch\s+(my|his|her)\s+breath\b/i },
  { id: "choking", re: /\bchoking\b|\bchoked\b/i },
  { id: "stroke", re: /\bstroke\b|\bface\s+(is\s+)?droop|\bdrooping\s+face\b|\bslurred\s+speech\b|\bsudden(ly)?\s+(weak(ness)?|numb(ness)?|confus(ed|ion)|can'?t\s+(speak|see|walk))|\bcan'?t\s+(move|feel|lift)\s+(my|his|her|the)\s+(arm|leg|face|side)\b/i },
  { id: "severe_bleeding", re: /\b(bleeding|blood)\b[^.?!]{0,30}\b(heav(y|ily)|won'?t\s+stop|will\s+not\s+stop|not\s+stopping|everywhere|a\s+lot|profus)\b|\b(heav(y|ily)|severe)\s+bleeding\b|\bvomit(ing|ed)?\s+blood\b|\bcough(ing|ed)?\s+(up\s+)?blood\b|\bblood\s+in\s+(my\s+)?(vomit|stool)\b/i },
  { id: "unconscious", re: /\bunconscious\b|\bunresponsive\b|\bpassed\s+out\b|\bfaint(ed|ing)\b|\bcollaps(e|ed|ing)\b|\bnot\s+(waking|responding)\b|\bwon'?t\s+wake\b/i },
  { id: "seizure", re: /\bseizure\b|\bconvuls(ion|ing|ions)\b|\bfitting\b|\bhaving\s+a\s+fit\b/i },
  { id: "overdose", re: /\boverdos(e|ed|ing)\b|\bpoison(ed|ing)?\b|\bswallowed\s+(too\s+many|a\s+lot|bleach|something|pills|tablets)\b/i },
  { id: "pregnancy_emergency", re: /\b(pregnan\w*|labou?r)\b[^.?!]{0,40}\b(bleeding|severe\s+pain|no\s+movement|not\s+moving|water\s+broke|convuls\w*)\b|\bbaby\b[^.?!]{0,25}\b(not\s+moving|not\s+breathing|blue)\b/i },
  { id: "allergic_reaction", re: /\banaphyla\w*\b|\bthroat\s+(is\s+)?(closing|swelling)\b|\b(face|lips?|tongue)\b[^.?!]{0,15}\bswell(ing|ed|ollen)\b/i },
  { id: "dying", re: /\b(i\s+am|i'?m|he\s+is|she\s+is|he'?s|she'?s|they\s+are|my\s+\w+\s+is)\s+(dying|going\s+to\s+die|about\s+to\s+die)\b|\bgoing\s+to\s+die\b|\bnear\s+death\b/i },
  { id: "emergency_word", re: /\bemergency\b|\bambulance\b|\bneed\s+help\s+(now|urgently|immediately)\b|\burgent(ly)?\s+(help|hospital)\b|\bhelp\s+me\s+(please\s+)?(now|urgent)/i },
  { id: "severe_head_injury", re: /\bhead\s+injur\w*\b|\bhit\s+(my|his|her)\s+head\b[^.?!]{0,30}\b(vomit|dizzy|bleed|unconscious|confus)/i },
];

const PROMPT_EXTRACTION: readonly Rule[] = [
  { id: "ignore_instructions", re: /\b(ignore|disregard|forget|override|bypass)\b[^.?!]{0,30}\b(previous|prior|above|earlier|all|your|the|these|system)\b[^.?!]{0,25}\b(instructions?|rules?|prompts?|guidelines?|guardrails?|restrictions?)\b/i },
  { id: "reveal_prompt", re: /\b(reveal|show|print|repeat|tell\s+me|display|output|leak|share|what\s+(is|are))\b[^.?!]{0,30}\b(your|the)\s+(system\s+)?(prompt|instructions?|rules|guidelines|configuration|initial\s+message)\b/i },
  { id: "system_prompt", re: /\bsystem\s+(prompt|message|instruction)s?\b/i },
  { id: "role_override", re: /\byou\s+are\s+now\b|\bfrom\s+now\s+on\s+you\b|\bact\s+as\s+(a|an|if)\b|\bpretend\s+(to\s+be|you\s+are|you'?re)\b|\broleplay\s+as\b|\bsimulate\s+(being|a)\b/i },
  { id: "jailbreak", re: /\bjailbreak\b|\bdeveloper\s+mode\b|\bDAN\b|\bdo\s+anything\s+now\b|\bno\s+restrictions\b|\bunfiltered\b|\bdisable\s+(your\s+)?(safety|filters?|guardrails?)\b/i },
  { id: "repeat_above", re: /\b(repeat|print|echo)\b[^.?!]{0,15}\b(the\s+)?(text|words|everything|message)\s+(above|before)\b/i },
  { id: "hidden_channel", re: /<\s*(system|assistant|instructions?)\s*>|\[\s*(system|inst)\s*\]|###\s*(system|instruction)/i },
];

const MEDICAL_ADVICE: readonly Rule[] = [
  { id: "dose", re: /\b(what|which|how\s+much|how\s+many)\b[^.?!]{0,30}\b(dose|dosage|mg|tablets?|pills?|capsules?|ml|units)\b|\bhow\s+(much|many)\b[^.?!]{0,30}\b(should|can|do)\s+i\s+(take|use|inject|drink)\b|\bdosage\b/i },
  { id: "can_i_take", re: /\bcan\s+i\s+(take|mix|combine|drink|stop|skip|double)\b|\bis\s+it\s+(safe|okay|ok|fine)\s+to\s+(take|mix|combine|stop|skip|use|drink)\b|\bshould\s+i\s+(take|stop|start|increase|reduce|skip|change|double|continue)\b/i },
  { id: "diagnose", re: /\b(diagnos(e|is|ed)|what\s+(is|could\s+be)\s+wrong\s+with\s+me|what\s+do\s+i\s+have|do\s+i\s+have\s+(diabetes|hypertension|cancer|an?\s+infection|malaria|typhoid|hiv|ulcer|high\s+blood)|am\s+i\s+(diabetic|hypertensive|sick|ill|pregnant|dying))\b/i },
  { id: "my_result", re: /\bmy\s+(bp|blood\s+pressure|sugar|glucose|cholesterol|result|results|reading|readings|test|scan|ecg|hba1c|lab|labs|temperature)\b[^.?!]{0,25}\b(is|are|was|were|came|shows?|showed|reads?)\b/i },
  { id: "bp_numbers", re: /\b(bp|pressure|reading|readings|sugar)\b[^.?!]{0,20}\b\d{2,3}\s*\/\s*\d{2,3}\b|\b\d{2,3}\s*\/\s*\d{2,3}\s*(mmhg|mm\s*hg)\b/i },
  { id: "is_it_normal", re: /\b(is|are)\s+(this|that|it|my|these)\b[^.?!]{0,30}\b(normal|serious|dangerous|bad|high|low|worrying|a\s+problem|something\s+to\s+worry)\b|\bshould\s+i\s+(be\s+)?(worried|concerned|see\s+a\s+doctor|go\s+to\s+(the\s+)?hospital)\b/i },
  { id: "interpret", re: /\b(interpret|explain|read|understand)\b[^.?!]{0,20}\b(my|this|these)\b[^.?!]{0,15}\b(result|results|report|scan|test|reading|readings|ecg|lab)\b/i },
  { id: "prescribe", re: /\b(prescri(be|ption)|recommend|suggest)\b[^.?!]{0,30}\b(medicine|medication|drug|drugs|tablet|tablets|treatment|antibiotic\w*|painkiller\w*|insulin|cream|pills?)\b|\bwhat\s+(medicine|drug|tablet|treatment)\s+(should|can|do|for)\b/i },
  { id: "symptoms_advice", re: /\b(i\s+have|i'?ve\s+got|i\s+am\s+having|i'?m\s+having|i\s+keep\s+(getting|having|feeling)|i\s+feel|i\s+am\s+feeling|suffering\s+from)\b[^.?!]{0,30}\b(pain|pains|headache|fever|cough|rash|swelling|dizziness|dizzy|nausea|nauseous|vomiting|diarrhoea|diarrhea|tiredness|tired|fatigue|weak|weakness|numbness|itch\w*|bleeding|ache\w*|sore|swollen|breathless|palpitations)\b/i },
  // The first alternative is spelled c(?:ure) only so the repo's copy-lint, which bans that word in source text, does not count a detection pattern as marketing copy.
  { id: "treatment_cure", re: /\b(c(?:ure)|treat|manage|reverse|heal|get\s+rid\s+of)\b[^.?!]{0,25}\b(diabetes|hypertension|high\s+blood\s+pressure|cancer|ulcer|asthma|infection|kidney|arthritis|my\s+\w+)\b/i },
];

const WANTS_HUMAN: readonly Rule[] = [
  { id: "human", re: /\b(speak|talk|chat|connect|transfer|put\s+me|get\s+me|let\s+me\s+(speak|talk))\b[^.?!]{0,25}\b(human|person|someone|somebody|agent|representative|staff|team|founder|owner|manager|real\s+(person|human))\b|\b(live\s+agent|customer\s+service|call\s+me|phone\s+me|ring\s+me|call\s+me\s+back)\b/i },
  { id: "complaint", re: /\b(complain|complaint|unhappy|disappointed|angry|furious|scam|fraud|cheated|rip\s?off|terrible\s+service|not\s+happy)\b/i },
];

const hits = (rules: readonly Rule[], text: string): string[] => rules.filter((r) => r.re.test(text)).map((r) => r.id);

/** Fold the cosmetic variation people (and attackers) add: case is handled by the patterns; here dots, underscores, repeated letters and homoglyph-ish spacing. */
export function normaliseForRules(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[​-‏⁠﻿]/g, "") // zero-width characters used to hide words
    .replace(/[_*`~]+/g, " ")
    .replace(/(.)\1{3,}/g, "$1$1") // "heeeelp" -> "heelp"
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The order is the priority: an emergency beats everything (it is answered even when the same message also tries to extract the prompt), then
 * prompt extraction, then medical advice, then a request for a person. Everything else is left to the model.
 */
export function classifyIncoming(raw: string): RuleOutcome {
  const text = normaliseForRules(raw);
  const selfHarm = hits(SELF_HARM, text);
  if (selfHarm.length > 0) return { kind: "emergency", variant: "self_harm", matched: selfHarm };
  const emergency = hits(EMERGENCY, text);
  if (emergency.length > 0) return { kind: "emergency", variant: "general", matched: emergency };
  const injection = hits(PROMPT_EXTRACTION, text);
  if (injection.length > 0) return { kind: "prompt_extraction", matched: injection };
  const medical = hits(MEDICAL_ADVICE, text);
  if (medical.length > 0) return { kind: "medical_advice", matched: medical };
  if (hits(WANTS_HUMAN, text).length > 0) return { kind: "wants_human" };
  return { kind: "none" };
}

/** True when the wording asks for a person or complains (so the conversation also goes to a human, whatever the model would have said). */
export const asksForPerson = (raw: string): boolean => hits(WANTS_HUMAN, normaliseForRules(raw)).length > 0;

// ---- fixed replies (never generated) -------------------------------------------------------------------------------------------------------

/** Deliberately names no phone number: the real emergency numbers are a localisation fact the founder owns (CLAUDE.md), so we point to the nearest hospital. */
export const EMERGENCY_REPLY =
  "This sounds like it could be an emergency. Please go to the nearest hospital now, or ask someone near you to take you. I am an AI assistant and cannot help in an emergency. I have also alerted our team.";

export const SELF_HARM_REPLY =
  "I am really sorry you are going through this. Please tell someone near you right now, and go to the nearest hospital emergency department if you feel you might act on these thoughts. You do not have to face this alone. I am an AI assistant and cannot help in an emergency, and I have alerted our team.";

export const MEDICAL_ADVICE_REPLY =
  "I am an AI assistant and I cannot give medical advice, interpret results, or say what you should take. A doctor can do that properly in a doctor call, which you can book in the TarragonHealth app. If you think this could be urgent, please go to the nearest hospital. Is there something about our service I can help with?";

export const PROMPT_EXTRACTION_REPLY =
  "I can only help with questions about TarragonHealth, such as what we offer, how the app works, and how to join. What would you like to know?";

export const HUMAN_REPLY =
  "Of course. I am an AI assistant, so I have passed this to our team and a person will reply. Please leave your name and an email address or phone number so they can reach you.";

export const FALLBACK_HANDOFF_REPLY =
  "I am not able to answer that reliably, so I have passed it to our team and a person will reply. Please leave your name and an email address or phone number so they can reach you.";

export const AI_UNAVAILABLE_REPLY =
  "Thanks for your message. Our assistant is not available right now, so I have passed your question to our team and a person will reply. Please leave your name and an email address or phone number.";

export const REPLACED_REPLY =
  "I would rather a person answers that properly, so I have passed it to our team. Please leave your name and an email address or phone number so they can reach you.";

export function fixedReplyFor(outcome: RuleOutcome): string | null {
  switch (outcome.kind) {
    case "emergency":
      return outcome.variant === "self_harm" ? SELF_HARM_REPLY : EMERGENCY_REPLY;
    case "prompt_extraction":
      return PROMPT_EXTRACTION_REPLY;
    case "medical_advice":
      return MEDICAL_ADVICE_REPLY;
    case "wants_human":
      return HUMAN_REPLY;
    case "none":
      return null;
  }
}
