import type { Metadata } from "next";
import { AudienceTabs } from "../_components/audience-tabs";
import { CtaBand } from "../_components/cta-band";
import { MarketingMediaFrame } from "../_components/marketing-media-frame";
import { MarketingHero } from "../_components/marketing-hero";
import { Section } from "../_components/section";
import { AUDIENCE_TABS } from "../_content/services";
import { MARKETING_MEDIA } from "../_content/media";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "Who it's for",
  description:
    "Pick your starting point: managing your own health, staying well, looking after a parent, running a workforce, or covering an HMO membership.",
  path: MARKETING_ROUTES.whoItsFor,
});

export default function WhoItsForPage() {
  return (
    <>
      {/* This page is the audience ROUTER: five doors, each leading to the
          page that answers that audience properly (individuals to /for-you,
          families to /parentcare, employers to /corporate, HMOs to /hmo).
          It deliberately does not restate what /for-you says at length. */}
      <Section className="pt-20">
        <MarketingHero media={MARKETING_MEDIA.pageHero.whoItsFor}>
          <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
            Who it&apos;s for
          </p>
          <h1 className="mt-2 font-heading text-4xl font-bold leading-tight text-charcoal-ink sm:text-5xl">
            Find your starting point
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
            Five people arrive here for five different reasons. Pick the one that sounds like
            you, and we will take you to the page written for it. The same connected record sits
            underneath all of them.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3 lg:justify-start">
            <Button asChild size="lg">
              <Link href={MARKETING_ROUTES.forYou}>I&apos;m here for myself</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={MARKETING_ROUTES.pricing}>View pricing</Link>
            </Button>
          </div>
        </MarketingHero>
      </Section>

      <Section className="pt-2">
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
          title="See exactly what costs money"
          description="The app is free. A doctor's time is priced per piece of work, for individuals, families, and organisations."
          primaryHref={MARKETING_ROUTES.pricing}
          primaryLabel="View pricing"
          secondaryHref="/signup"
          secondaryLabel="Get started"
        />
      </Section>
    </>
  );
}
