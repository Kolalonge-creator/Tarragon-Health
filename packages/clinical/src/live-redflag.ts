import { screenWrittenQuestion } from "./written-question-screen";

/**
 * Live red-flag prompts (S77, spec 23.7, CMO decision S-10, INV-01).
 *
 * A deterministic matcher over one typed or pasted transcript segment. No model, no network, no speech-to-text. The rules are the SAME signed
 * danger-phrase list the written-question screen uses (`WRITTEN_QUESTION_DANGER_PHRASES`), so there is one list to sign and one place a phrase can
 * drift. Over-triggering is the accepted failure; under-triggering is not. The prompt is a visual, dismissible aid for the consulting clinician:
 * it never blocks, never decides and never contacts the patient.
 *
 * Nothing of the segment leaves the browser: a caller records only `phrase`, `ruleId` and `ruleVersion`.
 */
export const LIVE_RED_FLAG_RULE_ID = "written_question_danger_phrases";
/** Bump with the phrase list when the Chief Medical Officer signs a new version of it. */
export const LIVE_RED_FLAG_RULE_VERSION = 1;

export interface LivePrompt {
  readonly phrase: string;
  readonly ruleId: typeof LIVE_RED_FLAG_RULE_ID;
  readonly ruleVersion: number;
}

/**
 * The prompts one segment raises, leaving out any phrase already showing (`alreadyShown`), so a phrase said twice does not stack two banners.
 * A blank segment raises nothing.
 */
export function livePromptsForSegment(segment: string, alreadyShown: readonly string[] = []): readonly LivePrompt[] {
  if (segment.trim().length === 0) return [];
  const { matched } = screenWrittenQuestion(segment);
  return matched
    .filter((phrase) => !alreadyShown.includes(phrase))
    .map((phrase) => ({ phrase, ruleId: LIVE_RED_FLAG_RULE_ID, ruleVersion: LIVE_RED_FLAG_RULE_VERSION }));
}
