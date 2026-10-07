import { screenAssistantMessage } from "@tarragon/clinical";

/**
 * Deterministic first-pass safety net for the AI assistant. Runs before any Claude call, so an unambiguous red-flag message is
 * still caught if the LLM is slow, wrong, or unreachable (CLAUDE.md: never deprioritise or silently swallow).
 *
 * S51 (INV-01): this file no longer carries a private regex list. The rules are `screenAssistantMessage` from `@tarragon/clinical`,
 * which is built on the same shared phrase list the written-question screen and its database function use, plus the extra wordings
 * and word pairs real patients type in a chat ("my arm is numb"). One rule source, so the three deterministic lists cannot drift:
 * `packages/clinical/src/assistant-danger-screen.test.ts` fails if a shared phrase is dropped, and
 * `keyword-guardrail.test.ts` here fails if this file grows its own list again.
 *
 * Module 46 §46.11 (mental-health safety pathway): self-harm, suicidal ideation and psychotic symptoms move the conversation into the
 * urgent human pathway. As ever this is a best-effort net, never a claim of AI-determined safety (§46.12); the real backstop is a
 * human reviewing the resulting escalation.
 */
export function detectEmergencyKeywords(message: string): boolean {
  return screenAssistantMessage(message).redFlag;
}

/** The phrases that fired, for the audit trail (never the message text). */
export function emergencyMatches(message: string): readonly string[] {
  return screenAssistantMessage(message).matched;
}

/** Self-harm and suicide wording, which gets its own copy and routing (S52, INV-05). A subset of the emergency screen. */
const SELF_HARM_MARKERS: readonly string[] = [
  "suicid", "kill myself", "end my life", "ending my life", "want to die", "wants to die", "wanted to die", "don't want to live",
  "do not want to live", "self harm", "self-harm", "cutting myself", "hurting myself", "harming myself", "kill himself", "kill herself",
];

export function isSelfHarmMessage(message: string): boolean {
  const h = message.toLowerCase().replace(/[‘’ʼ]/g, "'");
  return SELF_HARM_MARKERS.some((m) => h.includes(m));
}
