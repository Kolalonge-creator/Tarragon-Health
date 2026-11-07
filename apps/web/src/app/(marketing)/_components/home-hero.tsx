"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { DEFAULT_HERO, getChannelHero, type ChannelHeroCopy } from "../_content/channel-heroes";
import Image from "next/image";
import { PhoneMockup } from "./phone-mockup";
import { MARKETING_MEDIA } from "../_content/media";

/**
 * Homepage hero, redesigned 2026-11-05 (website upgrade Phase 1, plan
 * section 4): a split layout with one headline, one supporting line, one
 * primary action, and the Tarragon family photograph with a real app capture
 * (synthetic demo patient) in a phone beside it. The founder asked on
 * 2026-11-05 to keep using the existing Tarragon photo library; the ambient
 * video is not loaded here (about 1 MB on a phone for no extra meaning).
 *
 * The `?channel=` re-skin is kept (HMO, employer and diaspora campaign links
 * still land on their own copy). It is read on the client so the page stays
 * static; `HomeHeroFallback` renders the default copy during prerender, so
 * most visitors see no swap.
 */
export function HomeHero() {
  const searchParams = useSearchParams();
  return <HomeHeroView hero={getChannelHero(searchParams.get("channel") ?? undefined)} />;
}

export function HomeHeroFallback() {
  return <HomeHeroView hero={DEFAULT_HERO} />;
}

function HomeHeroView({ hero }: { hero: ChannelHeroCopy }) {
  return (
    <section aria-labelledby="home-hero-title" className="px-4 pb-16 pt-10 sm:px-6 sm:pb-20 sm:pt-16 lg:pt-20">
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        <div className="grid min-w-0 gap-6">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-green">{hero.eyebrow}</p>
          <h1
            id="home-hero-title"
            className="text-balance font-heading text-[2.4rem] font-bold leading-[1.08] text-charcoal-ink sm:text-5xl lg:text-[3.6rem]"
          >
            {hero.title}
          </h1>
          <p className="max-w-[58ch] text-lg leading-relaxed text-charcoal-ink/80">{hero.description}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href={hero.primaryHref}
              className="inline-flex h-12 items-center justify-center rounded-full bg-brand-green px-6 text-base font-semibold text-white transition-colors hover:bg-brand-green/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
            >
              {hero.primaryLabel}
            </Link>
            <Link
              href={hero.secondaryHref}
              className="inline-flex h-12 items-center justify-center rounded-full border-[1.5px] border-brand-green px-6 text-base font-semibold text-brand-green transition-colors hover:bg-brand-green/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
            >
              {hero.secondaryLabel}
            </Link>
          </div>
          <p className="flex items-start gap-2 text-[15px] text-mk-muted">
            <ShieldCheck aria-hidden className="mt-0.5 h-[18px] w-[18px] shrink-0 text-brand-green" />
            Preventive healthcare, guided by clinicians and supported by technology.
          </p>
        </div>

        <div className="relative mx-auto w-full max-w-md pb-10 lg:max-w-none lg:pb-0 lg:pr-10">
          <Image
            src={MARKETING_MEDIA.homepage.hero.imageSrc ?? ""}
            alt={MARKETING_MEDIA.homepage.hero.imageAlt ?? ""}
            width={1400}
            height={1750}
            loading="eager"
            // The page's LCP, so it gets fetch priority over scripts. On a phone the 300px hint picks a smaller file (828px on a
            // typical 2.6x Android, 1080px on a 3x iPhone) instead of the full-width one. hero-photo-phone-size.test.tsx pins both.
            fetchPriority="high"
            sizes="(min-width: 1024px) 520px, (max-width: 639px) 300px, 90vw"
            className="aspect-[4/5] w-full rounded-[28px] object-cover"
          />
          <PhoneMockup
            className="absolute -bottom-2 -right-1 lg:-right-2"
            src={MARKETING_MEDIA.homepage.solution.imageSrc ?? ""}
            alt={MARKETING_MEDIA.homepage.solution.imageAlt ?? ""}
            width={1206}
            height={1880}
            frameWidth={160}
          />
        </div>
      </div>
    </section>
  );
}
