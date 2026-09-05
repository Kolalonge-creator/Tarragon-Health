import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MarketingHero } from "./marketing-hero";
import { PhotoBannerHero } from "./marketing-photo-banner-hero";
import { Section, SectionHeading } from "./section";
import { CtaBand } from "./cta-band";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { cn } from "@/lib/utils";
import { EligibilityChecker } from "./eligibility-checker";
import { RoiCalculator } from "./roi-calculator";
import { StepsExplorer } from "./steps-explorer";
import { AnimatedNumber } from "./animated-number";
import type { B2bPageContent } from "../_content/b2b";
import { PILL_TONE } from "../_content/pill-tone";

export function B2bPageTemplate({ content }: { content: B2bPageContent }) {
  const contactHref = `${MARKETING_ROUTES.contact}?source=${content.slug}`;
  const hasPhoto = Boolean(content.hero.imageSrc);

  return (
    <>
      {hasPhoto ? (
        // Rendered outside Section on purpose — full-bleed spans the full
        // viewport width; see marketing-photo-banner-hero.tsx's header comment.
        <PhotoBannerHero
          eyebrow={content.campaignLine}
          title={content.headline}
          description={content.intro}
          primaryHref={contactHref}
          primaryLabel={content.ctaLabel}
          secondaryHref={MARKETING_ROUTES.pricing}
          secondaryLabel="View pricing"
          imageSrc={content.hero.imageSrc ?? ""}
          imageAlt={content.hero.imageAlt ?? ""}
          imagePosition={content.hero.imageFocus}
        />
      ) : (
        <Section className="pt-20">
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
      )}

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
          {content.included.map((item, index) => (
            <Card
              key={item}
              asChild
              className={cn(
                "hover:shadow-sm",
                // An odd count would leave the last card orphaned in the left
                // column; span it instead so the grid always closes cleanly.
                index === content.included.length - 1 &&
                  content.included.length % 2 === 1 &&
                  "sm:col-span-2"
              )}
            >
              <li className="p-4 text-charcoal-ink/75">
                <span className="mr-2 font-semibold text-brand-green">Included:</span>
                {item}
              </li>
            </Card>
          ))}
        </ul>
      </Section>

      <Section variant="sage">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
              Example
            </p>
            <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
              {content.exampleTitle}
            </h2>
            <p className="mt-4 text-charcoal-ink/70">{content.exampleNote}</p>
          </div>
          {/* The numbers below are illustrative, not client data. The
              "Illustrative example" note sits in the copy column beside this
              card, which a visitor scanning the figures can easily miss, so
              the card labels itself too. Do not remove this badge while the
              figures are samples. */}
          <Card className="p-6 hover:shadow-sm">
            <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-sprout-gold/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-charcoal-ink">
              <span aria-hidden>◆</span>
              Sample report
            </p>
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
                  <AnimatedNumber value={stat.value} />
                  {stat.pill ? (
                    // Deliberately not the shared clinical-status Badge component — its
                    // red/amber/green variants are reserved for the dashboard's clinical
                    // severity system, not marketing copy (see badge.tsx's own header
                    // comment and CLAUDE.md's brand-colour-vs-status-colour rule). This
                    // pill uses brand tokens (sage/gold) instead.
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", PILL_TONE[stat.pill.tone])}>
                      {stat.pill.text}
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </Card>
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="Your path" title="How it works" size="large" />
        <div className="mx-auto max-w-3xl">
          <StepsExplorer steps={content.howItWorks} tone="green" />
        </div>
      </Section>

      {(content.slug === "corporate" || content.slug === "hmo") && (
        <Section>
          <SectionHeading
            title={content.slug === "hmo" ? "Check your coverage" : "Coverage & the numbers"}
          />
          <div className="grid items-start gap-10 lg:grid-cols-2">
            <EligibilityChecker source={content.slug === "hmo" ? "hmo" : "corporate"} />
            <RoiCalculator />
          </div>
        </Section>
      )}

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
