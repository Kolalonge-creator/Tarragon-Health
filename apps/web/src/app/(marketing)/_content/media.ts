/**
 * Marketing media registry: illustrations, optional photos, and video embeds.
 *
 * To swap an illustration for a real photo, set `imageSrc` (file under
 * `public/marketing/`, e.g. `/marketing/hero-family.jpg`) and leave
 * `illustration` unset. To add a walkthrough video, set `youtubeId` to the
 * ID from a YouTube URL (https://youtube.com/watch?v=THIS_PART).
 *
 * Video strategy (Omada/Virta pattern; never a raw YouTube player in a hero):
 * - `PRODUCT_VIDEOS` below: one click-to-play explainer per programme page,
 *   hosted on the Tarragon YouTube channel. A page's video section renders
 *   ONLY once its `youtubeId` is filled in (no "coming soon" placeholders),
 *   so lighting a page up is a one-line edit here when the channel is live.
 * - `videoSrc` on a media slot: a muted, looping, self-hosted ambient clip
 *   (file under `public/marketing/`, MP4, no sound, a few seconds) for the
 *   homepage hero banner. Use professionally shot footage only; until then
 *   the illustrated hero stays. Setting `videoSrc` on `homepage.hero` swaps
 *   the hero visual to footage automatically.
 */

export type MarketingIllustrationId =
  | "family-care"
  | "fragmented-care"
  | "connected-care"
  | "clinician-follow-up"
  | "hypertension"
  | "diabetes"
  | "obesity"
  | "parentcare"
  | "prevention";

export type MarketingMediaSlot = {
  /** Inline SVG illustration when no photo is available yet. */
  illustration?: MarketingIllustrationId;
  /** Path under public/, e.g. `/marketing/hero.jpg` */
  imageSrc?: string;
  imageAlt?: string;
  /**
   * Muted looping ambient clip under public/, e.g. `/marketing/hero.mp4`.
   * Takes precedence over image/illustration; decorative only (no sound,
   * no controls), so pair it with real text content beside it.
   */
  videoSrc?: string;
};

export const MARKETING_MEDIA = {
  homepage: {
    // Widened (not `satisfies`) so callers can check the optional videoSrc:
    // setting it here swaps the homepage hero to ambient footage.
    hero: {
      illustration: "family-care",
      imageAlt: "Adult child checking in on a parent's health via phone",
    } as MarketingMediaSlot,
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
    obesity: { illustration: "obesity" } satisfies MarketingMediaSlot,
    parentcare: { illustration: "parentcare" } satisfies MarketingMediaSlot,
    prevention: { illustration: "prevention" } satisfies MarketingMediaSlot,
    medication: { illustration: "connected-care" } satisfies MarketingMediaSlot,
    labs: { illustration: "prevention" } satisfies MarketingMediaSlot,
  },
  serviceCard: {
    hypertension: { illustration: "hypertension" } satisfies MarketingMediaSlot,
    diabetes: { illustration: "diabetes" } satisfies MarketingMediaSlot,
    obesity: { illustration: "obesity" } satisfies MarketingMediaSlot,
    parentcare: { illustration: "parentcare" } satisfies MarketingMediaSlot,
    prevention: { illustration: "prevention" } satisfies MarketingMediaSlot,
    medication: { illustration: "connected-care" } satisfies MarketingMediaSlot,
    labs: { illustration: "prevention" } satisfies MarketingMediaSlot,
  },
} as const;

export type ProductVideo = {
  /** Fill in from the Tarragon YouTube channel; empty = section not rendered. */
  youtubeId: string;
  title: string;
  caption: string;
};

/**
 * One explainer video per programme page (click-to-play, branded poster).
 * The section only appears on a page once its youtubeId is set, so there is
 * never a placeholder video block on a live page.
 */
export const PRODUCT_VIDEOS: Record<string, ProductVideo> = {
  hypertension: {
    youtubeId: "",
    title: "See how Tarragon manages blood pressure",
    caption:
      "How readings, medication, doctor review, and escalation work together to keep your blood pressure followed up between visits.",
  },
  diabetes: {
    youtubeId: "",
    title: "See how Tarragon manages diabetes",
    caption:
      "Glucose logs, HbA1c, labs, and medication on one record, and what happens when your numbers need a closer look.",
  },
  obesity: {
    youtubeId: "",
    title: "See how the obesity programme works",
    caption:
      "A structured, doctor-reviewed programme: weight tracking, a lifestyle plan, and related conditions watched on the same record.",
  },
  parentcare: {
    youtubeId: "",
    title: "See how ParentCare keeps you close",
    caption:
      "How monitoring, doctor follow-up, and calm opt-in family updates work for a parent in Nigeria, wherever you live.",
  },
  prevention: {
    youtubeId: "",
    title: "See how preventive screening works",
    caption:
      "Your personal screening calendar, booking through partner labs, and what happens the moment a result needs attention.",
  },
  medication: {
    youtubeId: "",
    title: "See how medication support works",
    caption:
      "Reminders, refill alerts before you run out, and doctor follow-up when doses are missed.",
  },
  labs: {
    youtubeId: "",
    title: "See how lab coordination works",
    caption:
      "Knowing what's due, seeing the exact price, booking a trusted lab, and getting every result reviewed.",
  },
};
