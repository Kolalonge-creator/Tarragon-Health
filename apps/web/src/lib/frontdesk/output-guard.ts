/**
 * Front Desk F3, the POST-check: fixed rules that run on what the model wrote BEFORE a visitor sees it. The model may be wrong; this is what
 * stops a wrong answer being a harmful one. It blocks: a diagnosis, a dose, an interpretation of a result, a guarantee or a claim to heal, a claim to
 * be a person or a doctor, and ANY price, percentage, link, email address or phone number that is not in the approved knowledge the model was
 * given. A blocked reply is replaced with fixed wording and the conversation goes to a person and to review. Pure.
 */
export interface GuardResult {
  readonly ok: boolean;
  readonly violations: readonly string[];
}

export interface GuardContext {
  /** The resolved approved knowledge text (live prices filled in). Anything numeric or addressable in a reply must appear in it. */
  readonly knowledge: string;
}

const CONDITIONS =
  "diabet\\w*|hypertens\\w*|high blood pressure|low blood pressure|cancer|malaria|typhoid|hiv|aids|ulcer|asthma|infection|kidney\\w*|heart\\s+(disease|failure|attack)|stroke|anaemi\\w*|anemi\\w*|arthritis|depress\\w*|anxiety|covid\\w*|tuberculosis|tb|hepatitis|pregnan\\w*|sickle\\w*|cholesterol";

const BLOCKS: readonly { readonly id: string; readonly re: RegExp }[] = [
  { id: "diagnosis", re: new RegExp(`\\byou\\s+(?:likely\\s+|probably\\s+|may\\s+|might\\s+|could\\s+|definitely\\s+)?(?:have|had|suffer\\s+from|are\\s+suffering\\s+from|are\\s+diabetic|are\\s+hypertensive)\\b[^.?!]{0,25}\\b(?:${CONDITIONS})\\b`, "i") },
  { id: "diagnosis", re: new RegExp(`\\b(?:this|that|it|your\\s+symptoms?)\\s+(?:is|are|sounds?\\s+like|looks?\\s+like|could\\s+be|may\\s+be|might\\s+be|indicates?|suggests?|points?\\s+to)\\b[^.?!]{0,20}\\b(?:${CONDITIONS}|a\\s+sign\\s+of)\\b`, "i") },
  { id: "diagnosis", re: /\byou\s+(?:are|seem|appear)\s+(?:diabetic|hypertensive|anaemic|anemic|pre-?diabetic|obese|infected|sick|ill)\b/i },
  { id: "dose", re: /\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|ug|g|ml|iu|units?|tablets?|pills?|capsules?|drops?|puffs?)\b/i },
  { id: "dose", re: /\b(?:once|twice|thrice|three\s+times|two\s+times|every\s+\d+\s+hours?)\s+(?:a|per|each|daily|every)?\s*(?:day|daily|night|morning|week)\b|\btake\s+(?:one|two|three|\d+|a|an|the)\s+(?:tablet|pill|capsule|dose|injection)/i },
  { id: "result_interpretation", re: /\byour\s+(?:bp|blood\s+pressure|sugar|glucose|cholesterol|result|results|reading|readings|test|scan|temperature|hba1c)\b[^.?!]{0,30}\b(?:is|are|was|were|looks?|seems?)\b[^.?!]{0,20}\b(?:high|low|normal|abnormal|elevated|fine|good|bad|healthy|concerning|worrying|dangerous)\b/i },
  { id: "result_interpretation", re: /\b\d{2,3}\s*\/\s*\d{2,3}\s*(?:mmhg|mm\s*hg)\b/i },
  { id: "guarantee", re: /\bguarantee[sd]?\b|\b100\s?%|\bcure[sd]?\b|\bwill\s+(?:definitely|certainly|surely)\b|\brisk[- ]free\b|\bno\s+side\s+effects\b|\bmiracle\b/i },
  { id: "claims_to_be_human", re: /\bi\s+(?:am|'m)\s+(?:a\s+|an\s+|your\s+)?(?:real\s+)?(?:doctor|nurse|pharmacist|clinician|human|person|member\s+of\s+(?:staff|the\s+team)|the\s+founder)\b|\bas\s+a\s+(?:doctor|nurse|clinician)\b/i },
  { id: "medical_instruction", re: /\byou\s+should\s+(?:take|stop|start|increase|reduce|avoid|eat|drink|inject)\b|\bi\s+(?:would\s+)?(?:recommend|advise|suggest|prescribe)\s+(?:that\s+)?(?:you\s+)?(?:to\s+)?(?:take|taking|stop|start|using|use|increase|reduce)\b/i },
  { id: "promise_of_doctor_review", re: /\ba\s+doctor\s+(?:has\s+)?(?:reviewed|approved|checked|confirmed|signed)\b|\breviewed\s+by\s+(?:dr|doctor)\b/i },
];

const digitsOnly = (s: string): string => s.replace(/[^\d]/g, "");

/** Every figure that appears in the approved knowledge, normalised to digits, so "120,000" and "120000" are the same figure. */
function allowedFigures(knowledge: string): Set<string> {
  const out = new Set<string>();
  for (const m of knowledge.matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.add(digitsOnly(m[0]));
  return out;
}

const ALLOWED_HOSTS = ["tarragonhealth.ng", "www.tarragonhealth.ng", "app.tarragonhealth.ng"];
const ALLOWED_EMAILS = ["hello@tarragonhealth.ng", "support@tarragonhealth.ng", "admin@tarragonhealth.ng"];

export function guardReply(reply: string, ctx: GuardContext): GuardResult {
  const violations = new Set<string>();
  for (const b of BLOCKS) if (b.re.test(reply)) violations.add(b.id);

  const known = allowedFigures(ctx.knowledge);
  // Money and percentages: any amount not in the knowledge is an invented price.
  for (const m of reply.matchAll(/(?:₦|NGN|N|USD|\$|£|€)\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:naira|NGN|USD|dollars?|%)/gi)) {
    const figure = digitsOnly(m[1] ?? m[2] ?? "");
    if (figure !== "" && !known.has(figure)) violations.add("unapproved_figure");
  }
  // Links, email addresses and phone numbers: only the ones the business has published.
  for (const m of reply.matchAll(/\b(?:https?:\/\/|www\.)([^\s/)]+)[^\s)]*/gi)) {
    const host = (m[1] ?? "").toLowerCase().replace(/[.,;:]+$/, "");
    if (!ALLOWED_HOSTS.includes(host)) violations.add("unapproved_link");
  }
  for (const m of reply.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    if (!ALLOWED_EMAILS.includes(m[0].toLowerCase()) && !ctx.knowledge.toLowerCase().includes(m[0].toLowerCase())) violations.add("unapproved_contact");
  }
  for (const m of reply.matchAll(/(?:\+?\d[\d\s().-]{6,}\d)/g)) {
    const digits = digitsOnly(m[0]);
    if (digits.length >= 7 && !known.has(digits) && !ctx.knowledge.replace(/[^\d]/g, "").includes(digits)) violations.add("unapproved_contact");
  }
  return { ok: violations.size === 0, violations: [...violations].sort() };
}
