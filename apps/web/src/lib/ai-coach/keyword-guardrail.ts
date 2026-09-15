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
 *
 * Widened 2026-09-14 after a real evaluation run (scripts/ai-coach-safety-
 * eval.ts) caught four natural patient phrasings the original adjacency-
 * only patterns missed entirely: "tight, crushing feeling in my chest"
 * (chest pain — original required the literal substring "tight in my
 * chest"), "thinking about ending my life" (suicide — required "end my
 * life", not "ending"), "my speech is slurred" (stroke — required the
 * fixed word order "slurred speech"), and "too many of my tablets"
 * (overdose — required "too many" directly adjacent to "tablets"). The
 * `.{0,N}` gaps below tolerate the words a real patient puts in between
 * without loosening the patterns to the point of matching unrelated text —
 * see keyword-guardrail.test.ts for both the new positive cases and the
 * existing negative controls this was checked against.
 */
const EMERGENCY_PATTERNS: RegExp[] = [
  /chest pain|tight(?:ness)?.{0,40}chest|chest.{0,40}tight/i,
  /can'?t breathe|difficulty breathing|shortness of breath/i,
  /suicid|kill myself|end(?:ing|ed)? (?:my|his|her|their) life|want(?:s|ed)? to die/i,
  /cutting myself|hurting myself|self.?harm|harming myself/i,
  /hear(?:ing)? voices|see(?:ing)? things that (?:aren'?t|are not) there|thoughts? (?:are )?not my own/i,
  /severe bleeding|won'?t stop bleeding|bleeding heavily/i,
  /stroke|face.{0,40}droop|droop.{0,40}face|speech.{0,30}slur|slur.{0,30}speech|sudden numbness/i,
  /unconscious|passed out|fainted/i,
  /seizure|convuls/i,
  /overdose|took too many.{0,30}(?:pills|tablets|medication|meds)/i,
];

export function detectEmergencyKeywords(message: string): boolean {
  return EMERGENCY_PATTERNS.some((pattern) => pattern.test(message));
}
