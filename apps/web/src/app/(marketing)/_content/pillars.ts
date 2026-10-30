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
    title: "Eating",
    body: "An eating pattern built around the food you can already get.",
  },
  {
    module: "activity",
    title: "Activity",
    body: "Regular activity: a daily walk and two or three strength sessions a week.",
  },
  {
    module: "sleep",
    title: "Sleep",
    body: "Good sleep makes blood pressure and blood sugar easier to control.",
  },
  {
    module: "stress",
    title: "Stress",
    body: "A few minutes of slow breathing each day can lower blood pressure.",
  },
  {
    module: "behaviour",
    title: "Consistency",
    body: "A weekly plan built around your real routine, not an ideal one.",
  },
] as const;

export const PILLARS_SECTION_COPY = {
  eyebrow: "Beyond the numbers",
  title: "Five daily habits that affect the numbers your care team monitors",
  description: "Your care team uses your readings to write a short weekly plan that is specific to you.",
} as const;
