/**
 * Spoken script for BRE-01, "Three minute calm" (Audio Production List 7.6, spec 8.7). The counting cues are part of the
 * script, so the words are generated from the pace to keep them in step with the visual pacer. The pace is the PROPOSED
 * `breathing.bre01` value; this module takes it as arguments and never reads it itself.
 *
 * Draft, not signed. It carries stop-if-unwell wording, so it is treated as clinical: the CMO signs the wording
 * before it is recorded. English only (D-14). Numbers are written as words (list section 3.5).
 */
export interface Bre01Pace {
  readonly inhaleSeconds: number;
  readonly exhaleSeconds: number;
  readonly durationSeconds: number;
}

const WORD = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"] as const;
const CAP = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"] as const;

const countUp = (from: number, to: number): string => {
  const parts: string[] = [];
  for (let n = from; n <= to; n++) parts.push(WORD[n]);
  return parts.join(", ");
};

export function renderBre01Script(pace: Bre01Pace): string {
  const cycle = pace.inhaleSeconds + pace.exhaleSeconds;
  const breaths = Math.max(1, Math.floor(pace.durationSeconds / cycle));
  const minutes = Math.round((breaths * cycle) / 60);
  const title = minutes >= 1 && minutes <= 10 ? `${CAP[minutes]} minute calm.` : "A calm breathing exercise.";
  const intro =
    `${title} Sit comfortably, with your back supported and your feet on the floor. Let your shoulders drop. There is nothing to achieve here. ` +
    `If you feel dizzy, or anything feels wrong, stop and breathe normally. Breathe gently through your nose. ` +
    `We will breathe in for ${WORD[pace.inhaleSeconds]}, and out for ${WORD[pace.exhaleSeconds]}.`;
  const oneBreath = `Breathe in, ${countUp(2, pace.inhaleSeconds)}. Breathe out, ${countUp(2, pace.exhaleSeconds)}.`;
  const outro =
    "Gently let your breathing return to normal. Notice how your body feels. When you are ready, open your eyes. " +
    "Keep taking your medicines and measuring your blood pressure as agreed with your care team.";
  return [intro, ...Array.from({ length: breaths }, () => oneBreath), outro].join("\n\n");
}

/** The pace the committed script was generated for. A test in `@tarragon/shared` checks it equals `breathing.bre01`. */
export const BRE01_SCRIPT_PACE: Bre01Pace = { inhaleSeconds: 4, exhaleSeconds: 6, durationSeconds: 180 };
