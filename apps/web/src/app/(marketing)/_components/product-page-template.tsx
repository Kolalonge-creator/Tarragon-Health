import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MarketingHero } from "./marketing-hero";
import { PhotoBannerHero } from "./marketing-photo-banner-hero";
import { Section, SectionHeading } from "./section";
import { CtaBand } from "./cta-band";
import { EmergencyNotice } from "./emergency-notice";
import { MarketingVideo } from "./marketing-video";
import { StepsExplorer } from "./steps-explorer";
import { MARKETING_MEDIA, PRODUCT_VIDEOS } from "../_content/media";
import type { ProductPageContent } from "../_content/products";
import { PRICING_HREF } from "../_content/products";

export function ProductPageTemplate({
  content,
  children,
}: {
  content: ProductPageContent;
  /** Optional page-specific sections, rendered after "How it works". */
  children?: React.ReactNode;
}) {
  const heroMedia =
    MARKETING_MEDIA.productHero[content.slug as keyof typeof MARKETING_MEDIA.productHero] ?? {
      illustration: "connected-care" as const,
    };
  // Only render the video section once a real YouTube ID exists; a page with
  // no video shows nothing rather than a placeholder block.
  const video = PRODUCT_VIDEOS[content.slug];
  const hasVideo = Boolean(video?.youtubeId.trim());
  // "Start monitoring" fits an ongoing chronic-condition page; it reads oddly
  // on prevention/neutral pages sharing this template, which use "Get started".
  const isChronicCondition = ["hypertension", "diabetes", "obesity"].includes(content.slug);
  const ctaLabel = isChronicCondition ? "Start monitoring" : "Get started";
  // dohealth-style full-bleed photo hero (see marketing-photo-banner-hero.tsx)
  // is the site's primary hero now, same as the homepage — but only once a
  // real photo is sourced for this slug (media.ts's productHero map). A slug
  // with no imageSrc yet (currently only "prevention") falls back to the
  // older text-beside-a-card MarketingHero rather than stretching an
  // illustration across a full-bleed banner it was never designed for.
  const hasPhoto = Boolean(heroMedia.imageSrc);

  return (
    <>
      {hasPhoto ? (
        <Section className="pt-6 sm:pt-8">
          <PhotoBannerHero
            eyebrow={content.campaignLine}
            title={content.headline}
            description={content.intro}
            primaryHref="/signup"
            primaryLabel={ctaLabel}
            secondaryHref={PRICING_HREF}
            secondaryLabel="View pricing"
            imageSrc={heroMedia.imageSrc ?? ""}
            imageAlt={heroMedia.imageAlt ?? ""}
            imagePosition={heroMedia.imageFocus}
          />
        </Section>
      ) : (
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
                <Link href="/signup">{ctaLabel}</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href={PRICING_HREF}>View pricing</Link>
              </Button>
            </div>
          </MarketingHero>
        </Section>
      )}

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
        <div className="mx-auto max-w-3xl">
          <p className="text-center text-sm font-medium uppercase tracking-wide text-deep-forest">
            Your path
          </p>
          <h2 className="mt-2 text-center font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
            How it works for you
          </h2>
          <div className="mt-8">
            <StepsExplorer steps={content.howItWorks} tone="green" />
          </div>
        </div>
      </Section>

      {hasVideo ? (
        <Section>
          <MarketingVideo
            youtubeId={video.youtubeId}
            title={video.title}
            caption={video.caption}
            poster={heroMedia}
          />
        </Section>
      ) : null}

      {children}

      <Section>
        <EmergencyNotice />
      </Section>

      <Section>
        <CtaBand
          title="Ready to get started?"
          description="Join TarragonHealth and bring continuity to your care."
          primaryLabel={ctaLabel}
          secondaryHref={PRICING_HREF}
          secondaryLabel="View pricing"
        />
      </Section>
    </>
  );
}
