/**
 * Inbound WhatsApp handling — intents, NEVER logs (spec §10.4).
 *
 * A number sent over WhatsApp is never written as a measurement; it produces a
 * "log it in the app" reply. Free-text is screened for danger language and, if
 * present, routed to escalation; otherwise it goes to the human clinician
 * inbox. This module is a pure classifier — it performs no side-effects.
 */

export type InboundIntent =
  | "admin_confirm" // "YES" / "refill"
  | "log_attempt" // a number or "log 128/82" — redirect to the app
  | "concern_urgent" // danger language — escalate to a human immediately
  | "concern_general"; // free-text — route to the clinician inbox

export interface InboundClassification {
  intent: InboundIntent;
  /** Message key for the (non-diagnostic) auto-reply. */
  replyKey: string;
}

/** Danger language that must be routed to a human at once (not exhaustive; a
 *  classifier replaces this deny-list in Phase 5). */
const URGENT_PATTERNS: readonly RegExp[] = [
  /\b(chest pain|can'?t breathe|cannot breathe|struggling to breathe)\b/i,
  /\b(suicid|kill myself|end my life|harm myself|hurt myself)\b/i,
  /\b(collaps|unconscious|passed out|faint)\b/i,
  /\b(stroke|slurred speech|face droop|numb on one side)\b/i,
];

const ADMIN_PATTERNS: readonly RegExp[] = [
  /^\s*(yes|y|confirm|ok|okay)\s*$/i,
  /\brefill\b/i,
];

/** True if the message is (or contains) a bare measurement-looking number. */
function looksLikeLog(text: string): boolean {
  const t = text.trim();
  // "128/82", "5.6", "log 90", "72 kg"
  return /(^|\s)(log\s+)?\d{1,3}(\.\d+)?(\s*\/\s*\d{1,3})?(\s*(kg|mmol|bpm|mmhg))?\s*$/i.test(t);
}

export function classifyInboundMessage(text: string): InboundClassification {
  for (const re of URGENT_PATTERNS) {
    if (re.test(text)) {
      return { intent: "concern_urgent", replyKey: "inbound.urgent_safety_net" };
    }
  }
  for (const re of ADMIN_PATTERNS) {
    if (re.test(text)) {
      return { intent: "admin_confirm", replyKey: "inbound.admin_ack" };
    }
  }
  if (looksLikeLog(text)) {
    return { intent: "log_attempt", replyKey: "inbound.log_in_app" };
  }
  return { intent: "concern_general", replyKey: "inbound.routed_to_team" };
}
