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
    body: "An eating pattern built around food you already have access to.",
  },
  {
    module: "activity",
    title: "Move",
    body: "Regular movement, a daily walk, a couple of strength sessions a week.",
  },
  {
    module: "sleep",
    title: "Sleep",
    body: "Better sleep makes blood pressure and blood sugar easier to control.",
  },
  {
    module: "stress",
    title: "Relax",
    body: "A few minutes of breathing can lower your readings more than you'd expect.",
  },
  {
    module: "behaviour",
    title: "Follow through",
    body: "A weekly plan built around your actual week, not an ideal one.",
  },
] as const;

export const PILLARS_SECTION_COPY = {
  eyebrow: "Beyond the numbers",
  title: "Five habits move the numbers your care team already watches",
  description: "Your care team turns your readings into a short, personal weekly plan.",
} as const;
