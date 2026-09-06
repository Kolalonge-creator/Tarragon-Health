/**
 * Deterministic first-pass safety net for the AI Coach. Runs before any
 * Claude call, so an unambiguous red-flag message is still caught if the
 * LLM is slow, wrong, or unreachable — CLAUDE.md: "never deprioritise or
 * silently swallow" applies to this chat the same way it does to abnormal
 * screening results.
 *
 * Module 46 §46.11 (mental-health safety pathway) explicitly names
 * self-harm and psychotic symptoms alongside suicidal ideation as indicators
 * that must move the conversation into the urgent/human pathway — the
 * suicide patterns already covered that; self-harm and psychosis patterns
 * are added below. As with the rest of this list, these are a best-effort
 * deterministic net, never a claim of AI-determined safety (§46.12) — the
 * real backstop is always a human reviewing the resulting escalation.
 */
const EMERGENCY_PATTERNS: RegExp[] = [
  /chest pain|tight(?:ness)? in (?:my|the) chest/i,
  /can'?t breathe|difficulty breathing|shortness of breath/i,
  /suicid|kill myself|end my life|want to die/i,
  /cutting myself|hurting myself|self.?harm|harming myself/i,
  /hear(?:ing)? voices|see(?:ing)? things that (?:aren'?t|are not) there|thoughts? (?:are )?not my own/i,
  /severe bleeding|won'?t stop bleeding|bleeding heavily/i,
  /stroke|face (?:is )?droop|slurred speech|sudden numbness/i,
  /unconscious|passed out|fainted/i,
  /seizure|convuls/i,
  /overdose|took too many (?:pills|tablets)/i,
];

export function detectEmergencyKeywords(message: string): boolean {
  return EMERGENCY_PATTERNS.some((pattern) => pattern.test(message));
}
