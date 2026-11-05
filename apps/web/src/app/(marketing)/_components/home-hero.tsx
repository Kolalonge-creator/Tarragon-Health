"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { DEFAULT_HERO, getChannelHero, type ChannelHeroCopy } from "../_content/channel-heroes";
import { ExamplePhone } from "./home-example-screens";

/**
 * Homepage hero, redesigned 2026-11-05 (website upgrade Phase 1, plan
 * section 4): a split layout with one headline, one supporting line, one
 * primary action, and an example app screen beside it. It replaces the
 * full-bleed photo/video hero, whose image came from an image generator and whose video
 * cost about 1 MB on a phone. A licensed photograph (founder decision W-02)
 * slots into the panel behind the phone once it is chosen.
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
            className="text-balance font-heading text-[2.4rem] font-medium leading-[1.08] text-charcoal-ink sm:text-5xl lg:text-[3.6rem]"
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

        <div className="relative mx-auto w-full max-w-md lg:max-w-none">
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 top-10 rounded-[28px] bg-[radial-gradient(120%_80%_at_75%_15%,rgba(224,162,59,0.35),transparent_60%),linear-gradient(160deg,#0b5d45,#0e3b2e)]"
          />
          <div className="relative flex justify-center px-6 pb-8">
            <ExamplePhone screen="today" className="w-[min(78%,300px)]" />
          </div>
        </div>
      </div>
    </section>
  );
}
