/**
 * S51 (spec 7.2): a deterministic floor under the model's own `isHealthInformationRequest` flag. The structural refusal ("no reviewed
 * source, no answer") must not depend on the model saying the question is informational, so this recognises the plain shapes of
 * "tell me what X is, means, causes, is safe, is normal" in code. It is a floor: the model may flag more, never less. Over-refusing a
 * borderline question routes the patient to their care team with fixed copy; answering one from general knowledge is the failure.
 *
 * Questions that are only about the patient's own scheduling or logging ("when is my next appointment", "I logged my walk") do not match.
 */
const INFO_PATTERNS: RegExp[] = [
  /\bwhat (?:is|are|does(?!\s+you\b)|do(?!\s+you\b)|causes?)\b/i,
  /\bwhy (?:do|does|is|am|are|did)\b/i,
  /\bis (?:it|this|that) (?:safe|normal|ok|okay|bad|dangerous|serious|harmful|common|contagious)\b/i,
  /\b(?:safe|okay|ok) to (?:eat|drink|take|use|do|have|try)\b/i,
  /\bhow (?:do|can|should) i (?:treat|manage|prevent|lower|raise|control|cope)\b/i,
  /\b(?:side effects?|symptoms? of|causes? of|treatment for|signs? of)\b/i,
  /\bwhat (?:does|do|did|would)\b(?!\s+you\b).{0,50}\bmean\b/i,
  /\bshould i (?:worry|be worried|be concerned)\b/i,
  /\b(?:is|are) (?:my|the|this|that|these|those)\b.{0,40}\b(?:normal|safe|ok|okay|bad|dangerous|serious|harmful|high|low)\b/i,
];

const SCHEDULING_ONLY = /\b(?:when is|what time is|where is|how do i (?:book|log|add|change my appointment|reset|sign)|why do i (?:need|have) to (?:log|add|enter|record|book))\b/i;

/** The patient asking WHAT THEIR OWN RECORD SAYS ("what is my last reading", "what medicines am I on"). The record tools answer these. */
const RECORD_LOOKUP =
  /\bmy (?:last|latest|recent|current|most recent|next|previous)\b|\bwhat (?:is|are) my (?:blood pressure|bp|weight|pulse|glucose|sugar|medications?|medicines|tablets|appointments?|readings?|results?|allergies|conditions|care plan|goals?|tasks?|plan)\b|\bwhat (?:medicines?|medications?|tablets?|pills?) am i on\b|\bwhat does my care plan (?:say|include|have|contain)\b/i;
/** Words that ask for meaning, safety or advice. A record lookup that ALSO asks for these ("what does my last result mean") is informational. */
const MEANING = /\b(?:mean|means|meaning|normal|safe|ok|okay|dangerous|serious|harmful|worry|worried|why|treat|treatment|manage|prevent|side effects?|symptoms? of|causes?)\b/i;

export function looksLikeHealthInformationQuestion(message: string): boolean {
  if (SCHEDULING_ONLY.test(message)) return false;
  if (!INFO_PATTERNS.some((re) => re.test(message))) return false;
  if (RECORD_LOOKUP.test(message) && !MEANING.test(message)) return false;
  return true;
}
