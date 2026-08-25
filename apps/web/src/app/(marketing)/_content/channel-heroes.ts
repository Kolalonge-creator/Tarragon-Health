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

export const DEFAULT_HERO: ChannelHeroCopy = {
  eyebrow: "Continuity, not just monitoring",
  title: "Care that stays with you.",
  description:
    "Health monitoring for chronic disease, prevention, and care coordination, with clinical review and escalation when closer care is needed.",
  primaryHref: "/signup",
  primaryLabel: "Get started",
  secondaryHref: MARKETING_ROUTES.services,
  secondaryLabel: "See how it works",
};

export const CHANNEL_HEROES: Record<ChannelHeroKey, ChannelHeroCopy> = {
  hmo: {
    eyebrow: "For HMO members",
    title: "Keep your HMO. Add the layer that watches.",
    description:
      "Your HMO pays your treatment bills when you're ill. Tarragon checks your BP and blood sugar against care protocols every time you log one, even when you feel fine, and gets a doctor involved early if something looks wrong.",
    primaryHref: "/signup",
    primaryLabel: "Get started",
    secondaryHref: MARKETING_ROUTES.howPricingWorks,
    secondaryLabel: "How we compare to your HMO",
  },
  employer: {
    eyebrow: "For teams",
    title: "A health benefit your team will actually use.",
    description:
      "Enrol your staff into real clinical monitoring for hypertension, diabetes, and preventive screening, then turn what we find into a clear, anonymised risk picture your HR team can act on.",
    primaryHref: MARKETING_ROUTES.corporate,
    primaryLabel: "Request employer health plan",
    secondaryHref: MARKETING_ROUTES.corporate,
    secondaryLabel: "See how it works for employers",
  },
  diaspora: {
    eyebrow: "For family abroad",
    title: "You already send money home for health.",
    description:
      "What you don't get back is any way of knowing what it paid for. Buy a specific check instead: you know exactly what you bought, and you're told when they use it.",
    primaryHref: MARKETING_ROUTES.pricing,
    primaryLabel: "See diaspora pricing",
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
