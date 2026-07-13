import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MarketingHero } from "./marketing-hero";
import { MarketingMediaFrame } from "./marketing-media-frame";
import { Section, SectionHeading } from "./section";
import { CtaBand } from "./cta-band";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { cn } from "@/lib/utils";
import type { B2bPageContent } from "../_content/b2b";

const PILL_TONE = {
  green: "bg-soft-sage text-deep-forest",
  amber: "bg-sprout-gold/15 text-charcoal-ink",
  red: "bg-[#F8E4E1] text-[#B0453B]",
} as const;

export function B2bPageTemplate({ content }: { content: B2bPageContent }) {
  const contactHref = `${MARKETING_ROUTES.contact}?source=${content.slug}`;

  return (
    <>
      <Section className="relative overflow-hidden pt-20">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-brand-green/10 blur-3xl"
        />
        <MarketingHero media={content.hero}>
          <h1 className="font-heading text-4xl font-bold text-charcoal-ink sm:text-5xl">
            {content.headline}
          </h1>
          <p className="mt-6 font-heading text-xl text-brand-green">{content.campaignLine}</p>
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">{content.intro}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3 lg:justify-start">
            <Button asChild size="lg">
              <Link href={contactHref}>{content.ctaLabel}</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={MARKETING_ROUTES.pricing}>View pricing</Link>
            </Button>
          </div>
        </MarketingHero>
      </Section>

      {content.pullQuote ? (
        <Section variant="navy">
          <blockquote className="mx-auto max-w-3xl text-center font-heading text-2xl font-semibold leading-snug sm:text-3xl">
            &ldquo;{content.pullQuote}&rdquo;
          </blockquote>
        </Section>
      ) : null}

      <Section>
        <SectionHeading title="What's included" />
        <ul className="mx-auto grid max-w-4xl gap-3 sm:grid-cols-2">
          {content.included.map((item) => (
            <li
              key={item}
              className="rounded-xl border border-charcoal-ink/10 bg-white p-4 text-charcoal-ink/75"
            >
              <span className="mr-2 font-semibold text-brand-green">Included:</span>
              {item}
            </li>
          ))}
        </ul>
      </Section>

      <Section variant="sage">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-brand-green">
              Example
            </p>
            <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
              {content.exampleTitle}
            </h2>
            <p className="mt-4 text-charcoal-ink/70">{content.exampleNote}</p>
          </div>
          <div className="rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm">
            {content.exampleStats.map((stat, index) => (
              <div
                key={stat.label}
                className={cn(
                  "flex items-center justify-between gap-3 py-3.5",
                  index !== content.exampleStats.length - 1 && "border-b border-charcoal-ink/10"
                )}
              >
                <span className="text-sm font-medium text-charcoal-ink/70">{stat.label}</span>
                <span className="flex items-center gap-2 font-heading text-sm font-semibold text-charcoal-ink">
                  {stat.value}
                  {stat.pill ? (
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", PILL_TONE[stat.pill.tone])}>
                      {stat.pill.text}
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section>
        <div className="grid items-start gap-10 lg:grid-cols-[1fr_1fr]">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-brand-green">
              Your path
            </p>
            <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
              How it works
            </h2>
            <ol className="mt-8 grid gap-6">
              {content.howItWorks.map((item, index) => (
                <li
                  key={item.title}
                  className="flex gap-4 rounded-xl border border-charcoal-ink/10 bg-white p-6"
                >
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-green text-sm font-semibold text-white"
                    aria-hidden
                  >
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="font-heading text-lg font-semibold text-charcoal-ink">
                      {item.title}
                    </h3>
                    <p className="mt-1 text-charcoal-ink/70">{item.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <MarketingMediaFrame media={content.hero} className="lg:sticky lg:top-24" />
        </div>
      </Section>

      <Section variant="sage">
        <CtaBand
          variant="gradient"
          title={content.ctaLabel}
          description="Tell us about your organisation and we'll follow up personally with a clear, transparent quote."
          primaryHref={contactHref}
          primaryLabel={content.ctaLabel}
          secondaryHref={MARKETING_ROUTES.pricing}
          secondaryLabel="View pricing"
        />
      </Section>
    </>
  );
}
