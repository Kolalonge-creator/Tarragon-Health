/**
 * Marketing media registry: illustrations, optional photos, and video embeds.
 *
 * To swap an illustration for a real photo, set `imageSrc` (file under
 * `public/marketing/`, e.g. `/marketing/hero-family.jpg`) and leave
 * `illustration` unset. To add a walkthrough video, set `youtubeId` to the
 * ID from a YouTube URL (https://youtube.com/watch?v=THIS_PART).
 */

export type MarketingIllustrationId =
  | "family-care"
  | "fragmented-care"
  | "connected-care"
  | "clinician-follow-up"
  | "hypertension"
  | "diabetes"
  | "parentcare"
  | "prevention";

export type MarketingMediaSlot = {
  /** Inline SVG illustration when no photo is available yet. */
  illustration?: MarketingIllustrationId;
  /** Path under public/, e.g. `/marketing/hero.jpg` */
  imageSrc?: string;
  imageAlt?: string;
};

export const MARKETING_MEDIA = {
  homepage: {
    hero: {
      illustration: "family-care",
      imageAlt: "Adult child checking in on a parent's health via phone",
    } satisfies MarketingMediaSlot,
    problem: {
      illustration: "fragmented-care",
      imageAlt: "Missed reminders and scattered health information between visits",
    } satisfies MarketingMediaSlot,
    solution: {
      illustration: "connected-care",
      imageAlt: "Readings, reminders, and doctor review in one connected record",
    } satisfies MarketingMediaSlot,
    /** Set youtubeId when a product walkthrough is ready on YouTube. */
    walkthroughVideo: {
      youtubeId: "",
      title: "See how Tarragon keeps care connected",
      caption:
        "A two-minute look at logging vitals, doctor review, and coordinated follow-up: calm care between doctor visits.",
      poster: {
        illustration: "clinician-follow-up",
        imageAlt: "Doctor on a calm follow-up call with a patient",
      } satisfies MarketingMediaSlot,
    },
  },
  productHero: {
    hypertension: { illustration: "hypertension" } satisfies MarketingMediaSlot,
    diabetes: { illustration: "diabetes" } satisfies MarketingMediaSlot,
    parentcare: { illustration: "parentcare" } satisfies MarketingMediaSlot,
    prevention: { illustration: "prevention" } satisfies MarketingMediaSlot,
    medication: { illustration: "connected-care" } satisfies MarketingMediaSlot,
    labs: { illustration: "prevention" } satisfies MarketingMediaSlot,
  },
  serviceCard: {
    hypertension: { illustration: "hypertension" } satisfies MarketingMediaSlot,
    diabetes: { illustration: "diabetes" } satisfies MarketingMediaSlot,
    parentcare: { illustration: "parentcare" } satisfies MarketingMediaSlot,
    prevention: { illustration: "prevention" } satisfies MarketingMediaSlot,
    medication: { illustration: "connected-care" } satisfies MarketingMediaSlot,
    labs: { illustration: "prevention" } satisfies MarketingMediaSlot,
  },
} as const;
