/**
 * What a visitor is asking about, as one word from a fixed list. Rules only (no model), so it costs nothing, cannot be talked into anything,
 * and the weekly report can say "most asked about: pricing" without keeping what anyone wrote. The words are for the founder's report, not
 * for deciding anything about a visitor: a wrong topic changes a count, never an answer.
 */
export const TOPICS = [
  "complaint", "payment_refund", "pricing", "launch", "business_partnership", "privacy_data", "account_help", "tests_screening",
  "doctors_care", "conditions", "app_access", "how_it_works", "emergency", "other",
] as const;
export type Topic = (typeof TOPICS)[number];

// Order matters: the first rule that matches wins, most specific first.
const RULES: readonly (readonly [Exclude<Topic, "emergency" | "other">, RegExp])[] = [
  ["complaint", /\b(complain\w*|unhappy|angry|terrible|bad service|not happy|disappointed|rude|useless)\b/],
  ["payment_refund", /\b(refund\w*|money back|cancel\w*|charge ?back|paystack|debited|charged|double charge)\b/],
  ["pricing", /\b(price\w*|pricing|cost\w*|how much|fees?|afford\w*|cheap\w*|naira|free)\b|₦/],
  ["launch", /\b(launch\w*|opening date|open(s|ing)? when|when (will|does|do|is|are)\b[^?.]*\b(open|start|ready|live|available)|available yet|wait ?list|release)\b/],
  ["business_partnership", /\b(hmos?|employer\w*|compan(y|ies)|corporate|staff|employees|partner\w*|insurance|insurer|ngo|pharmacies|clinics)\b/],
  ["privacy_data", /\b(privacy|private|my data|data protection|ndpa|ndpc|confidential\w*|secure|security|who (can )?see|share my)\b/],
  ["account_help", /\b(sign ?up|sign ?in|log ?in|password|register\w*|verif\w+|my account|create an account)\b/],
  ["tests_screening", /\b(tests?|screening|screen|lab|labs|blood test|check ?up|health check|results?)\b/],
  ["doctors_care", /\b(doctors?|consult\w*|nurses?|care team|appointments?|book\w*|prescri\w+)\b/],
  ["conditions", /\b(blood pressure|hypertension|diabet\w*|sugar|bp|cholesterol|heart|kidney|asthma|chronic)\b/],
  ["app_access", /\b(app|download\w*|android|iphone|ios|play store|app store|website|phone)\b/],
  ["how_it_works", /\b(how (does|do|it|can)|what is|what do you|how it works|works?|service|membership|what you do|about)\b/],
];

/** One topic for one visitor message. Anything unrecognised is "other"; emergency wording is handled by the safety rules, not here. */
export function topicOf(text: string): Topic {
  const t = text.toLowerCase();
  for (const [topic, re] of RULES) if (re.test(t)) return topic;
  return "other";
}
