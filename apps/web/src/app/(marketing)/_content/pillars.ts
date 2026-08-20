import type { Database } from "@tarragon/shared";

/**
 * The five daily-habit areas behind a patient's weekly plan, keyed 1:1 to the
 * Lifestyle Programme Engine's `lpe_module` enum (diet/activity/behaviour/
 * sleep/stress — see supabase/migrations/20260719120001_lpe_foundation.sql)
 * so this marketing copy never drifts from what the product actually tracks.
 *
 * Deliberately five, not four: `behaviour` (day-to-day follow-through) is a
 * real fifth LPE module with no analogue in a generic "four pillars" framing.
 */
export type LpeModule = Database["public"]["Enums"]["lpe_module"];

export type PillarCopy = {
  module: LpeModule;
  title: string;
  body: string;
};

export const PILLARS: readonly PillarCopy[] = [
  {
    module: "diet",
    title: "Eat",
    body: "Food moves your numbers more than almost anything else. We help you build an eating pattern you can actually keep, built around food you already have access to, not a diet you quit by February.",
  },
  {
    module: "activity",
    title: "Move",
    body: "You don't need to become an athlete. Regular movement, a daily walk, two short strength sessions a week, does real work on blood pressure, blood sugar, and mood.",
  },
  {
    module: "sleep",
    title: "Sleep",
    body: "Poor sleep makes blood pressure and blood sugar harder to control. We start with the basics, a steadier bedtime, less light at night, whatever's keeping you up, before anything else.",
  },
  {
    module: "stress",
    title: "Relax",
    body: "Stress you carry every day shows up in your readings. A few minutes of breathing or a boundary you finally set can matter more than you'd expect.",
  },
  {
    module: "behaviour",
    title: "Follow through",
    body: "Knowing what to do is rarely the hard part. Doing it on a busy Tuesday is. This is the part of your plan built around what actually fits your week, not an ideal one.",
  },
] as const;

export const PILLARS_SECTION_COPY = {
  eyebrow: "Beyond the numbers",
  title: "Five habits move the numbers your care team already watches",
  description:
    "A results PDF full of numbers doesn't tell you what to do next, and reading it alone rarely feels good. Your care team turns your readings into a short, personal weekly plan built around these five areas, not a longer list of numbers to worry about.",
} as const;
