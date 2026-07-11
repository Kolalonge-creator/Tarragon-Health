import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MarketingHero } from "./marketing-hero";
import { MarketingMediaFrame } from "./marketing-media-frame";
import { Section, SectionHeading } from "./section";
import { CtaBand } from "./cta-band";
import { MARKETING_MEDIA } from "../_content/media";
import type { ProductPageContent } from "../_content/products";
import { PRICING_HREF } from "../_content/products";

export function ProductPageTemplate({ content }: { content: ProductPageContent }) {
  const heroMedia =
    MARKETING_MEDIA.productHero[content.slug as keyof typeof MARKETING_MEDIA.productHero] ?? {
      illustration: "connected-care" as const,
    };

  return (
    <>
      <Section className="relative overflow-hidden pt-20">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-brand-green/10 blur-3xl"
        />
        <MarketingHero media={heroMedia}>
          <h1 className="font-heading text-4xl font-bold text-charcoal-ink sm:text-5xl">
            {content.headline}
          </h1>
          {content.campaignLine ? (
            <p className="mt-6 font-heading text-xl text-brand-green">{content.campaignLine}</p>
          ) : null}
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">{content.intro}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3 lg:justify-start">
            <Button asChild size="lg">
              <Link href="/signup">Start monitoring</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={PRICING_HREF}>View pricing</Link>
            </Button>
          </div>
        </MarketingHero>
      </Section>

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
        <div className="grid items-start gap-10 lg:grid-cols-[1fr_1fr]">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-brand-green">
              Your path
            </p>
            <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
              How it works for you
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
          <MarketingMediaFrame media={heroMedia} className="lg:sticky lg:top-24" />
        </div>
      </Section>

      <Section>
        <CtaBand
          title="Ready to get started?"
          description="Join TarragonHealth and bring continuity to your care."
          secondaryHref={PRICING_HREF}
          secondaryLabel="View pricing"
        />
      </Section>
    </>
  );
}
