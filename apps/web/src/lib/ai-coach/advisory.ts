import type { AiRuntimeConfig } from "@/lib/ai-governance/types";

/**
 * W-10: AI-001 restricted to advisory display. "Restricted" restricts the ANSWERS, never the safety path: clinician alerts, the emergency
 * path and the keyword guardrails behave exactly as before. In this mode
 *   1. every model-written answer carries a short fixed note, and
 *   2. a question asking for specific advice about the patient's own medicines, doses or results goes to the care-team message flow
 *      instead of the model, using a fixed reply.
 *
 * Both fixed texts are hand-written, warm, and carry no clinical content. PENDING CMO SIGN-OFF: the wording below is a draft until the
 * Chief Medical Officer approves it (ADVISORY_WORDING_SIGNED stays false until then; a test pins that nobody flips it silently).
 */
export const ADVISORY_WORDING_SIGNED = false;

export const ADVISORY_NOTE =
  "This is general information, not medical advice. Your care team can answer questions about your own care.";

export const CARE_TEAM_REDIRECT_REPLY =
  "That is a question about your own care, so your care team is the best place to ask it. Please send them a message in the app and they will answer you directly. If you feel unwell or unsafe right now, go to the nearest hospital.";

export interface AdvisoryMode {
  readonly advisoryOnly: boolean;
  /** The configuration could not be read, so the coach assumed the restricted state. Logged by the caller. */
  readonly failedClosed: boolean;
}

/**
 * Fail closed. If the governance configuration for AI-001 could not be read or parsed (config is null) the coach behaves as restricted:
 * the note is added and personal-advice questions go to the care team. That adds caution only; it switches nothing off and removes no
 * safety behaviour. A readable configuration with restricted_mode 'none' is the only way out of the restricted state.
 */
export function resolveAdvisoryMode(config: AiRuntimeConfig | null): AdvisoryMode {
  if (config === null) return { advisoryOnly: true, failedClosed: true };
  return { advisoryOnly: config.restricted_mode !== "none", failedClosed: false };
}

const OWN = String.raw`\b(?:my|mine|i am on|i'm on|i take|i am taking|i'm taking)\b`;
const CARE_SUBJECT = String.raw`(?:medicine|medicines|medication|medications|meds|tablet|tablets|pill|pills|dose|doses|dosage|insulin|injection|prescription|drug|drugs|result|results|test|tests|scan|scans|reading|readings|blood pressure|blood sugar|glucose|cholesterol|hba1c|lab|labs)`;
const ADVICE_ASK = String.raw`(?:should i|can i|could i|may i|do i need|am i able|is it (?:ok|okay|safe|fine|normal|bad|good)|is that (?:ok|okay|safe|fine|normal|bad|good)|what should|what do i do|what does|what do|what is|what are|what's|how (?:do|should|can) i|is (?:this|that|it) (?:serious|dangerous|something)|do you think)`;

/**
 * True when the patient asks for specific advice about their OWN medicines, doses or results. Deterministic and deliberately wide: a
 * wrong match only sends a question to the care team, which is the safe direction. General questions ("what is blood pressure", "how
 * does insulin work") do not name the patient's own things and still reach the model, with the note.
 */
export function asksSpecificOwnCareAdvice(message: string): boolean {
  const text = message.toLowerCase();
  const ownThing = new RegExp(String.raw`${OWN}.{0,40}\b${CARE_SUBJECT}\b|\b${CARE_SUBJECT}\b.{0,12}\b(?:of mine|i (?:take|got|was given|am on))\b`, "i");
  const askingForAdvice = new RegExp(ADVICE_ASK, "i");
  return ownThing.test(text) && askingForAdvice.test(text);
}

/** The note is added to answers the model wrote, in advisory mode. Fixed-copy replies, emergencies and code-written refusals are left as they are. */
export function applyAdvisoryNote(
  reply: string,
  opts: { advisoryOnly: boolean; tier: string; replacedByCode: boolean },
): string {
  if (!opts.advisoryOnly || opts.tier === "emergency" || opts.replacedByCode) return reply;
  if (reply.includes(ADVISORY_NOTE)) return reply;
  return `${reply}\n\n${ADVISORY_NOTE}`;
}
