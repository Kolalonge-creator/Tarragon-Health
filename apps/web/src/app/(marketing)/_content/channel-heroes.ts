import { MARKETING_ROUTES } from "@/lib/marketing/routes";

/**
 * Channel-gated homepage hero copy: same page shell, same sections below the
 * fold, only the hero re-skins for traffic arriving with a known `?channel=`
 * value (an HMO's member portal, an employer's benefits page, a diaspora
 * remittance/referral link). Unlisted or missing values fall through to
 * `DEFAULT_HERO`, which is word-for-word the hero every other visitor sees —
 * a bad or absent link parameter must never produce a broken or blank hero.
 *
 * Deliberately reuses phrasing already approved elsewhere (HMO_COMPARE_NOTE's
 * "keep your HMO, add the layer that watches" framing, DIASPORA_SPONSOR_PITCH's
 * "you already send money home for health" hook) rather than inventing new
 * claims for a page nobody has reviewed copy for yet.
 */
export type ChannelHeroKey = "hmo" | "employer" | "diaspora";

export const CHANNEL_HERO_KEYS: ChannelHeroKey[] = ["hmo", "employer", "diaspora"];

export type ChannelHeroCopy = {
  eyebrow: string;
  title: string;
  description: string;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref: string;
  secondaryLabel: string;
};

/**
 * Rewritten 2026-09-22. The previous hero led with "Continuity, not just
 * monitoring" over a comma-separated category description ("Chronic care,
 * prevention, and family health tracking, in one app, with a doctor behind
 * it"). Both described the product's shape rather than the visitor's
 * situation, and neither carried the offer. The free-app / pay-only-for-a-
 * doctor's-time model (founder decision 2026-09-02) is the single strongest
 * hook this business has in a price-sensitive market, and it was previously
 * not mentioned until roughly the eighth section of the page.
 *
 * Every claim here is checked: the app genuinely is free (see
 * _content/pricing.ts), and the "stops when you leave the hospital" framing
 * is the reader's own experience, not a statistic this site cannot source.
 */
export const DEFAULT_HERO: ChannelHeroCopy = {
  eyebrow: "Free to join. You only pay for a doctor's time.",
  title: "Care that stays with you.",
  description:
    "Care usually stops the moment you leave the hospital. Tarragon is what happens next: your readings watched, your screenings tracked, and a doctor when you actually need one.",
  primaryHref: "/signup",
  primaryLabel: "Create your free account",
  secondaryHref: MARKETING_ROUTES.pricing,
  secondaryLabel: "See what it costs",
};

export const CHANNEL_HEROES: Record<ChannelHeroKey, ChannelHeroCopy> = {
  hmo: {
    eyebrow: "For HMO members",
    title: "Keep your HMO. Add the layer that watches.",
    description:
      "Your HMO pays when you're ill. Tarragon watches your BP and blood sugar so problems get caught early, even when you feel fine.",
    primaryHref: "/signup",
    primaryLabel: "Get started",
    secondaryHref: MARKETING_ROUTES.howPricingWorks,
    secondaryLabel: "How we compare to your HMO",
  },
  employer: {
    eyebrow: "For teams",
    title: "A health benefit your team will actually use.",
    description:
      "Enrol your team for hypertension, diabetes, and preventive screening, and get a clear, anonymised risk picture HR can act on.",
    primaryHref: MARKETING_ROUTES.corporate,
    primaryLabel: "Request employer health plan",
    secondaryHref: MARKETING_ROUTES.corporate,
    secondaryLabel: "See how it works for employers",
  },
  diaspora: {
    eyebrow: "For family abroad",
    title: "You already send money home for health.",
    description:
      "Buy a specific check instead. You know exactly what you paid for, and you're told when they use it.",
    primaryHref: MARKETING_ROUTES.gift,
    primaryLabel: "Gift a health check",
    secondaryHref: MARKETING_ROUTES.howPricingWorks,
    secondaryLabel: "How care vouchers work",
  },
};

export function getChannelHero(channel: string | undefined): ChannelHeroCopy {
  if (channel && (CHANNEL_HERO_KEYS as string[]).includes(channel)) {
    return CHANNEL_HEROES[channel as ChannelHeroKey];
  }
  return DEFAULT_HERO;
}
