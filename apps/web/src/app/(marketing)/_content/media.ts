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
 *   (file under `public/marketing/video/`, MP4, no sound, ~5s) rendered as
 *   decorative texture beside real text, never a player UI. Sourced either
 *   from professionally shot footage or an AI-generated ambient clip (this
 *   set: Higgsfield Seedance 2.0, generated 2026-08-03, anchored to the
 *   existing product stills via start_image so poster and video match).
 *   Every clip here is deliberately generic/ambient (hands, objects, a
 *   calm environment) and never depicts a specific clinical encounter,
 *   a named condition being diagnosed, or claims to be a real patient or
 *   doctor testimonial — see `docs/CLINICAL_TRUST_MODEL_SPEC.md` and the
 *   brand voice rule against fear-based/over-claiming imagery. Setting
 *   `videoSrc` on a slot swaps that visual to footage automatically.
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
  | "prevention"
  | "shared-record"
  | "care-loop"
  | "care-network"
  | "continuity-thread"
  | "response-clock"
  | "annual-checklist"
  | "gift-record"
  | "personalized-learning"
  | "vaccine-record";

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
      videoSrc: "/marketing/video/hero-family-care.mp4",
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
    // Note: once `videoSrc` is set, `imageSrc` is used ONLY as the raw HTML
    // <video poster> attribute (not run through next/image optimization), so
    // these point at the small pre-generated JPEG posters under
    // `video/*-poster.jpg`, not the original multi-MB source photos.
    hypertension: {
      imageSrc: "/marketing/video/hypertension-bp-monitor-poster.jpg",
      imageAlt: "A close-up of someone checking their blood pressure with a home monitor",
      videoSrc: "/marketing/video/hypertension-bp.mp4",
    } as MarketingMediaSlot,
    diabetes: {
      imageSrc: "/marketing/video/diabetes-glucometer-poster.jpg",
      imageAlt: "A close-up of a hand holding a glucometer showing a blood sugar reading",
      videoSrc: "/marketing/video/diabetes-glucometer.mp4",
    } as MarketingMediaSlot,
    obesity: {
      imageSrc: "/marketing/video/obesity-healthy-meal-poster.jpg",
      imageAlt: "Hands preparing a colorful, healthy meal at home",
      videoSrc: "/marketing/video/obesity-meal.mp4",
    } as MarketingMediaSlot,
    parentcare: {
      imageSrc: "/marketing/video/parentcare-video-call-poster.jpg",
      imageAlt: "A woman video calling an older relative from her living room",
      videoSrc: "/marketing/video/parentcare-video-call.mp4",
    } as MarketingMediaSlot,
    prevention: {
      // Was an AI-generated clip of a doctor placing a stethoscope on a
      // patient's palm (anatomically wrong — auscultation for a BP check
      // belongs at the inner elbow, not the wrist/palm) and the only hero
      // clip on the site depicting a specific clinical encounter rather
      // than the ambient hands/objects pattern documented above. Swapped
      // for the existing brand illustration until a corrected photo/clip
      // is sourced.
      illustration: "prevention",
      imageAlt: "A calendar and checklist representing a personal preventive screening plan",
    } as MarketingMediaSlot,
    medication: {
      imageSrc: "/marketing/video/medication-pill-organizer-poster.jpg",
      imageAlt: "Hands sorting medication into a weekly pill organizer",
      videoSrc: "/marketing/video/medication-pill-organizer.mp4",
    } as MarketingMediaSlot,
    labs: {
      imageSrc: "/marketing/video/labs-blood-sample-poster.jpg",
      imageAlt: "A gloved hand labeling a blood sample tube in a lab",
      videoSrc: "/marketing/video/labs-blood-sample.mp4",
    } as MarketingMediaSlot,
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
    title: "See how the weight programme works",
    caption:
      "A structured, doctor-reviewed programme: weight tracking, a lifestyle plan, and related conditions watched on the same record.",
  },
  parentcare: {
    youtubeId: "",
    title: "See how next of kin access keeps you close",
    caption:
      "How monitoring, doctor follow-up, and calm opt-in family updates work for a parent in Nigeria, wherever you live.",
  },
  prevention: {
    youtubeId: "",
    title: "See how preventive screening works",
    caption:
      "Your personal screening calendar, taking a request to any lab you like, and what happens the moment a result needs attention.",
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
      "Knowing what's due, taking your request to any lab you choose, and getting every result reviewed.",
  },
};
