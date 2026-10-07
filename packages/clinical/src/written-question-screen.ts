/**
 * The deterministic danger-phrase screen for a written question (S22, INV-01, INV-06).
 *
 * It runs on the phone before anything is sent, so it works offline, and the database runs the same list again when the
 * question arrives (`private.screen_care_message_for_emergency`). No model, no network. A match never blocks a patient from
 * getting help: it shows the bundled "go to the nearest hospital now" guidance and holds the send until the patient
 * chooses to go on. Over-triggering is the accepted failure; under-triggering is not.
 *
 * The list is the SAME list as the SQL function, and `written-question-screen.test.ts` fails if the two drift.
 */
export const WRITTEN_QUESTION_DANGER_PHRASES: readonly string[] = [
  "chest pain", "can't breathe", "cannot breathe", "difficulty breathing", "struggling to breathe",
  "unconscious", "unresponsive", "passed out", "collapsed",
  "suicide", "suicidal", "kill myself", "end my life", "want to die", "self harm", "self-harm",
  "severe bleeding", "bleeding heavily", "won't stop bleeding",
  "seizure", "convulsion", "convulsing", "fitting",
  "stroke", "face drooping", "slurred speech", "one side weak", "can't move my",
  "overdose", "took too many", "poisoned", "swallowed",
  "severe allergic reaction", "throat closing", "can't swallow",
  "blue lips", "turning blue", "not breathing", "baby not breathing", "baby not moving",
];

export interface WrittenQuestionScreen {
  readonly redFlag: boolean;
  readonly matched: readonly string[];
}

/** Curly apostrophes are what phone keyboards type; the phrase list uses the straight one. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[‘’ʼ]/g, "'");
}

export function screenWrittenQuestion(text: string): WrittenQuestionScreen {
  const haystack = normalise(text);
  const matched = WRITTEN_QUESTION_DANGER_PHRASES.filter((phrase) => haystack.includes(phrase));
  return { redFlag: matched.length > 0, matched };
}
