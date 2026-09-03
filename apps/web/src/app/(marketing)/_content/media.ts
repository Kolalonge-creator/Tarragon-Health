/**
 * Marketing media registry: illustrations, optional photos, and video embeds.
 *
 * To swap an illustration for a real photo, set `imageSrc` (file under
 * `public/marketing/`, e.g. `/marketing/hero-family.jpg`) and leave
 * `illustration` unset. To add a walkthrough video, set `youtubeId` to the
 * ID from a YouTube URL (https://youtube.com/watch?v=THIS_PART).
 *
 * Hero photography (2026-08-19, gift.hero added 2026-08-20, prevention +
 * b2b.ts's corporate/hmo heroes closed 2026-08-20): every primary hero slot
 * below (`homepage.hero`, `gift.hero`, every `productHero.*`, and
 * `corporate`/`hmo` in `_content/b2b.ts`) is a real photo under
 * `public/marketing/photos/hero/`, sourced from the curated Nigeria
 * photography library the founder maintains outside this repo (see the
 * `06-MARKETING/creative-assets/source-files/midjourney-library/INDEX.md`
 * working directory — its brand-check pass already vetted these against
 * `docs/BRAND_GUIDE.md` §8) — real people, not the ambient hands/objects
 * video loop or the line-illustration fallback. Illustration stays the
 * fallback only for `serviceCard` icons, which are deliberately abstract by
 * design. None of these photos are captioned or claimed as a real Tarragon
 * patient, family, or doctor — generic alt text only, matching the brand
 * rule against fabricated testimonials (see
 * `docs/CLINICAL_TRUST_MODEL_SPEC.md`).
 *
 * Video strategy (Omada/Virta pattern; never a raw YouTube player in a hero):
 * - `PRODUCT_VIDEOS` below: one click-to-play explainer per programme page,
 *   hosted on the Tarragon YouTube channel. A page's video section renders
 *   ONLY once its `youtubeId` is filled in (no "coming soon" placeholders),
 *   so lighting a page up is a one-line edit here when the channel is live.
 * - `videoSrc` on a media slot: a muted, looping, self-hosted ambient clip
 *   (file under `public/marketing/video/`, MP4, no sound, ~5s), rendered as
 *   decorative texture beside real text, never a player UI, WHEN a slot sets
 *   it. As of 2026-08-19 no hero slot sets `videoSrc` — real photography
 *   replaced the ambient clips as the primary hero visual — but the pattern
 *   (and the existing `hero-family-care.mp4` etc. under `public/marketing/
 *   video/`) stays available for a future slot that wants it. Any clip used
 *   this way must stay generic/ambient (hands, objects, a calm environment),
 *   never a specific clinical encounter or a claimed patient/doctor
 *   testimonial — see `docs/CLINICAL_TRUST_MODEL_SPEC.md`.
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
  /**
   * CSS object-position for `imageSrc` when used as a full-bleed background
   * (PhotoBannerHero) rather than a framed card (MarketingMediaFrame). Our
   * source photos are 4:5 portraits with the subject often sitting low or
   * spanning the full height, so a wide banner crop needs a manual focal
   * point — the default "center" clips faces on several of these. Unused by
   * MarketingMediaFrame, whose card aspect doesn't crop nearly as hard.
   */
  imageFocus?: string;
};

export const MARKETING_MEDIA = {
  homepage: {
    // Widened (not `satisfies`) so callers can check the optional videoSrc:
    // setting it here swaps the homepage hero to ambient footage.
    hero: {
      imageSrc: "/marketing/photos/hero/homepage-family-phone.jpg",
      imageAlt: "An adult daughter and her mother smiling together while looking at a phone",
      imageFocus: "center 20%",
    } as MarketingMediaSlot,
    problem: {
      imageSrc: "/marketing/photos/body/problem-medication-organiser.jpg",
      imageAlt: "Close-up of two people's hands sorting medication into a weekly pill organiser",
    } satisfies MarketingMediaSlot,
    solution: {
      imageSrc: "/marketing/photos/body/how-it-works-log-reading.jpg",
      imageAlt: "A hand holding a phone beside a home blood pressure cuff on a wooden table",
    } satisfies MarketingMediaSlot,
    preventionCallout: {
      imageSrc: "/marketing/photos/body/prevention-reviewing-notes.jpg",
      imageAlt: "A woman reviewing a printed health document at home",
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
    hypertension: {
      imageSrc: "/marketing/photos/hero/hypertension.jpg",
      imageAlt: "An older man reading his blood pressure monitor at home",
      imageFocus: "center 58%",
    } as MarketingMediaSlot,
    diabetes: {
      imageSrc: "/marketing/photos/hero/diabetes.jpg",
      imageAlt: "A woman preparing a meal at home with her glucometer on the counter beside her",
      imageFocus: "center 42%",
    } as MarketingMediaSlot,
    obesity: {
      imageSrc: "/marketing/photos/hero/obesity.jpg",
      imageAlt: "A couple cooking a healthy meal together at home, laughing",
      imageFocus: "center 38%",
    } as MarketingMediaSlot,
    parentcare: {
      imageSrc: "/marketing/photos/hero/parentcare.jpg",
      imageAlt: "A woman smiling on a video call with her mother",
      imageFocus: "center 50%",
    } as MarketingMediaSlot,
    prevention: {
      imageSrc: "/marketing/photos/hero/prevention.jpg",
      imageAlt: "A woman reviewing her personal health notes at home",
      imageFocus: "center 28%",
    } as MarketingMediaSlot,
    medication: {
      imageSrc: "/marketing/photos/hero/medication.jpg",
      imageAlt: "A man filling a weekly pill organiser for his father",
      imageFocus: "center 72%",
    } as MarketingMediaSlot,
    labs: {
      imageSrc: "/marketing/photos/hero/labs.jpg",
      imageAlt: "A patient smiling as she collects her results at a reception counter",
      imageFocus: "center 45%",
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
  gift: {
    hero: {
      imageSrc: "/marketing/photos/hero/gift.jpg",
      imageAlt: "A grandmother, mother, and child together outdoors in golden-hour light",
      imageFocus: "center 55%",
    } as MarketingMediaSlot,
  },
  /**
   * Full-bleed hero photos (2026-08-20) for the remaining top-of-funnel
   * marketing pages that previously had a plain text `<h1>` with no visual
   * hero at all — about, careers, services, who-its-for, chronic-care, and
   * care-coordination. Same PhotoBannerHero component and sourcing as
   * productHero above; see that block's comment for provenance.
   */
  pageHero: {
    about: {
      imageSrc: "/marketing/photos/hero/about.jpg",
      imageAlt: "A doctor thoughtfully reviewing patient notes at a laptop in the evening",
      imageFocus: "center 25%",
    } as MarketingMediaSlot,
    careers: {
      imageSrc: "/marketing/photos/hero/careers.jpg",
      imageAlt: "Colleagues talking together warmly in a bright office",
      imageFocus: "center 38%",
    } as MarketingMediaSlot,
    services: {
      imageSrc: "/marketing/photos/hero/services.jpg",
      imageAlt: "A hand holding a phone beside a blood pressure cuff on a table",
      imageFocus: "center 45%",
    } as MarketingMediaSlot,
    whoItsFor: {
      imageSrc: "/marketing/photos/hero/who-its-for.jpg",
      imageAlt: "An adult daughter and her mother smiling together at a phone",
      imageFocus: "center 26%",
    } as MarketingMediaSlot,
    chronicCare: {
      imageSrc: "/marketing/photos/hero/chronic-care.jpg",
      imageAlt: "A clinician reviewing a tablet with a seated older patient",
      imageFocus: "center 20%",
    } as MarketingMediaSlot,
    careCoordination: {
      imageSrc: "/marketing/photos/hero/care-coordination.jpg",
      imageAlt: "Three clinicians reviewing a case together around a laptop",
      imageFocus: "center 30%",
    } as MarketingMediaSlot,
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
