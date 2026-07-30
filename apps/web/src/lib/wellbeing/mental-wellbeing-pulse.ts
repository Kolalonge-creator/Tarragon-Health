/**
 * A short, anonymous, public wellbeing pulse-check for the marketing site.
 *
 * Deliberately NOT the platform's real clinical mental-health screen
 * (PHQ-9/GAD-7/AUDIT-C, apps/web/src/lib/rules/mental-health-screening.ts):
 * this tool is unauthenticated, has no clinician on the other end, and asks
 * nothing about self-harm, so it must never be styled or described as a
 * diagnostic or clinical instrument. It's a general wellbeing pulse-check,
 * closer to the general-population wellbeing scales used elsewhere (e.g.
 * WEMWBS-style items), not a depression/anxiety screener. Signed-up patients
 * get the real, clinician-reviewed screen as part of the Annual Health Check.
 *
 * Pure and stateless so it is unit-testable and can be re-run client-side
 * for an instant result.
 */

export type WellbeingBand = "thriving" | "steady" | "under_strain" | "struggling";

export const WELLBEING_QUESTION_COUNT = 10;
export const WELLBEING_MIN_SCORE = 1;
export const WELLBEING_MAX_SCORE = 5;

export const WELLBEING_QUESTIONS: string[] = [
  "I feel hopeful about what's ahead.",
  "I'm able to handle the day-to-day stress in my life.",
  "I feel calm, most of the time.",
  "I have people I can lean on when things get hard.",
  "I'm able to accept myself, as I am right now.",
  "I feel good about who I am.",
  "I'm getting enough rest to feel like myself.",
  "I can think clearly and make decisions without feeling overwhelmed.",
  "I find things in my day that I actually enjoy.",
  "When I'm struggling, I'm able to ask for help.",
];

export interface WellbeingResult {
  total: number;
  band: WellbeingBand;
}

export interface WellbeingBandCopy {
  label: string;
  body: string;
  nextStep: string;
}

export const WELLBEING_BAND_COPY: Record<WellbeingBand, WellbeingBandCopy> = {
  thriving: {
    label: "You're doing well",
    body: "Your answers suggest you're generally coping well, feeling supported, and finding things to enjoy. That's worth noticing, not just assuming.",
    nextStep: "Keep whatever's working for you. If that ever changes, a Tarragon doctor is a message away.",
  },
  steady: {
    label: "You're mostly steady",
    body: "You're managing, with some days harder than others; that's true for most people, most of the time. A little extra support now can help before small strain becomes a bigger one.",
    nextStep: "Consider talking it through with a doctor on Tarragon, not because something's wrong, but because it helps to say it out loud to someone.",
  },
  under_strain: {
    label: "You're under some real strain",
    body: "Your answers suggest things have felt genuinely hard lately: harder to cope, harder to rest, harder to feel like yourself. That's worth taking seriously, and worth talking to someone about.",
    nextStep: "Talking to a doctor is a reasonable next step, not a last resort. Tarragon's doctors can listen and help you figure out what support actually looks like for you.",
  },
  struggling: {
    label: "It sounds like you're struggling right now",
    body: "It's okay not to be okay. Whatever's going on, you don't have to carry it alone, and reaching out is a sign of strength, not weakness.",
    nextStep: "Please talk to someone today: a doctor, a trusted person, or one of the support lines below. If you're ever in immediate danger, go to the nearest emergency department right away.",
  },
};

/** Ordered by ascending score cut-off; the last entry is the catch-all top band. */
const BAND_THRESHOLDS: { min: number; band: WellbeingBand }[] = [
  { min: 0, band: "struggling" },
  { min: 22, band: "under_strain" },
  { min: 32, band: "steady" },
  { min: 42, band: "thriving" },
];

export function scoreWellbeingPulse(answers: number[]): WellbeingResult {
  if (answers.length !== WELLBEING_QUESTION_COUNT) {
    throw new Error(
      `Expected ${WELLBEING_QUESTION_COUNT} answers, got ${answers.length}`
    );
  }
  for (const value of answers) {
    if (
      !Number.isInteger(value) ||
      value < WELLBEING_MIN_SCORE ||
      value > WELLBEING_MAX_SCORE
    ) {
      throw new Error(
        `Answers must be integers ${WELLBEING_MIN_SCORE}-${WELLBEING_MAX_SCORE}`
      );
    }
  }

  const total = answers.reduce((sum, value) => sum + value, 0);
  let band: WellbeingBand = "struggling";
  for (const threshold of BAND_THRESHOLDS) {
    if (total >= threshold.min) {
      band = threshold.band;
    }
  }

  return { total, band };
}
