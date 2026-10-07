/**
 * S51 (spec 7.2): a deterministic floor under the model's own `isHealthInformationRequest` flag. The structural refusal ("no reviewed
 * source, no answer") must not depend on the model saying the question is informational, so this recognises the plain shapes of
 * "tell me what X is, means, causes, is safe, is normal" in code. It is a floor: the model may flag more, never less. Over-refusing a
 * borderline question routes the patient to their care team with fixed copy; answering one from general knowledge is the failure.
 *
 * Questions that are only about the patient's own scheduling or logging ("when is my next appointment", "I logged my walk") do not match.
 */
const INFO_PATTERNS: RegExp[] = [
  /\bwhat (?:is|are|does|do|causes?)\b/i,
  /\bwhy (?:do|does|is|am|are|did)\b/i,
  /\bis (?:it|this|that) (?:safe|normal|ok|okay|bad|dangerous|serious|harmful|common|contagious)\b/i,
  /\b(?:safe|okay|ok) to (?:eat|drink|take|use|do|have|try)\b/i,
  /\bhow (?:do|can|should) i (?:treat|manage|prevent|lower|raise|control|cope)\b/i,
  /\b(?:side effects?|symptoms? of|causes? of|treatment for|signs? of)\b/i,
  /\bmean(?:s|ing)?\b/i,
  /\bshould i (?:worry|be worried|be concerned)\b/i,
];

const SCHEDULING_ONLY = /\b(?:when is|what time is|where is|how do i (?:book|log|add|change my appointment|reset|sign))\b/i;

export function looksLikeHealthInformationQuestion(message: string): boolean {
  if (SCHEDULING_ONLY.test(message)) return false;
  return INFO_PATTERNS.some((re) => re.test(message));
}
