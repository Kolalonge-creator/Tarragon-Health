/**
 * Deterministic first-pass safety net for the AI Coach. Runs before any
 * Claude call, so an unambiguous red-flag message is still caught if the
 * LLM is slow, wrong, or unreachable — CLAUDE.md: "never deprioritise or
 * silently swallow" applies to this chat the same way it does to abnormal
 * screening results.
 */
const EMERGENCY_PATTERNS: RegExp[] = [
  /chest pain|tight(?:ness)? in (?:my|the) chest/i,
  /can'?t breathe|difficulty breathing|shortness of breath/i,
  /suicid|kill myself|end my life|want to die/i,
  /severe bleeding|won'?t stop bleeding|bleeding heavily/i,
  /stroke|face (?:is )?droop|slurred speech|sudden numbness/i,
  /unconscious|passed out|fainted/i,
  /seizure|convuls/i,
  /overdose|took too many (?:pills|tablets)/i,
];

export function detectEmergencyKeywords(message: string): boolean {
  return EMERGENCY_PATTERNS.some((pattern) => pattern.test(message));
}
