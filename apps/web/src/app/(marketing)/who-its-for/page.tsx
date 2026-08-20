import type { Metadata } from "next";
import { AudienceTabs } from "../_components/audience-tabs";
import { CtaBand } from "../_components/cta-band";
import { MarketingMediaFrame } from "../_components/marketing-media-frame";
import { PhotoBannerHero } from "../_components/marketing-photo-banner-hero";
import { Section } from "../_components/section";
import { AUDIENCE_TABS } from "../_content/services";
import { MARKETING_MEDIA } from "../_content/media";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "Who it's for",
  description:
    "TarragonHealth is built for individuals managing their health, families looking after a parent, employers, and HMOs.",
  path: MARKETING_ROUTES.whoItsFor,
});

export default function WhoItsForPage() {
  return (
    <>
      {/* Rendered outside Section on purpose — full-bleed spans the full
          viewport width; see marketing-photo-banner-hero.tsx's header comment. */}
      <PhotoBannerHero
        eyebrow="Who it's for"
        title="Whoever you're looking after, Tarragon speaks your language."
        description="The same connected record works whether you're managing your own health, keeping watch over a parent, or overseeing a whole workforce or membership."
        primaryHref="/signup"
        primaryLabel="Get started"
        secondaryHref={MARKETING_ROUTES.pricing}
        secondaryLabel="View pricing"
        imageSrc={MARKETING_MEDIA.pageHero.whoItsFor.imageSrc ?? ""}
        imageAlt={MARKETING_MEDIA.pageHero.whoItsFor.imageAlt ?? ""}
        imagePosition={MARKETING_MEDIA.pageHero.whoItsFor.imageFocus}
      />

      <Section className="pt-14">
        <AudienceTabs tabs={AUDIENCE_TABS} />
      </Section>

      <Section variant="sage">
        <div className="mx-auto grid max-w-4xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
              One record, everyone with a reason to see it
            </p>
            <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
              Not four different products
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              You, the family you look after, the employer sponsoring a plan, or the HMO backing
              one: everyone reads from the same longitudinal record, scoped to what they actually
              need to see. Nobody re-explains their history to a new system.
            </p>
          </div>
          <MarketingMediaFrame
            media={{
              illustration: "shared-record",
              imageAlt: "One health record, connected to the individual, their family, their employer, and their HMO",
            }}
          />
        </div>
      </Section>

      <Section className="pb-24">
        <CtaBand
          title="Find the plan that fits you"
          description="Clear plans with no hidden costs, for individuals, families, and organisations."
          primaryHref={MARKETING_ROUTES.pricing}
          primaryLabel="View pricing"
          secondaryHref="/signup"
          secondaryLabel="Get started"
        />
      </Section>
    </>
  );
}
