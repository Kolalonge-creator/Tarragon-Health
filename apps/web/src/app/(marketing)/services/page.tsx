import type { Metadata } from "next";
import { CtaBand } from "../_components/cta-band";
import { DashboardPreview } from "../_components/dashboard-preview";
import { MarketingMediaFrame } from "../_components/marketing-media-frame";
import { PhotoBannerHero } from "../_components/marketing-photo-banner-hero";
import { Section } from "../_components/section";
import { ServiceCardLink } from "../_components/service-card";
import { ConditionsMarquee } from "../_components/conditions-marquee";
import { StepsExplorer } from "../_components/steps-explorer";
import { HOW_IT_WORKS_STEPS, SERVICE_CARDS, WHAT_WE_TRACK } from "../_content/services";
import { MARKETING_MEDIA } from "../_content/media";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";
import { cn } from "@/lib/utils";

export const metadata: Metadata = pageMetadata({
  title: "Services",
  description:
    "Everything TarragonHealth helps you manage: chronic disease, preventive health, medication, labs, and care coordination, in one connected record.",
  path: MARKETING_ROUTES.services,
});

export default function ServicesPage() {
  return (
    <>
      {/* Rendered outside Section on purpose — full-bleed spans the full
          viewport width; see marketing-photo-banner-hero.tsx's header comment. */}
      <PhotoBannerHero
        eyebrow="Services"
        title="What we help you manage"
        description="Chronic disease, preventive health, medication, and labs, all on one shared record so nothing falls through the cracks between visits."
        primaryHref="/signup"
        primaryLabel="Get started"
        secondaryHref={MARKETING_ROUTES.pricing}
        secondaryLabel="View pricing"
        imageSrc={MARKETING_MEDIA.pageHero.services.imageSrc ?? ""}
        imageAlt={MARKETING_MEDIA.pageHero.services.imageAlt ?? ""}
        imagePosition={MARKETING_MEDIA.pageHero.services.imageFocus}
      />

      <Section className="pt-14">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICE_CARDS.map((service, index) => (
            <div
              key={service.key}
              // Centre a lone card on the last row so a 7th (or any 3n+1th)
              // entry doesn't sit orphaned in the left column.
              className={cn(
                index === SERVICE_CARDS.length - 1 &&
                  SERVICE_CARDS.length % 3 === 1 &&
                  "lg:col-start-2",
                index === SERVICE_CARDS.length - 1 &&
                  SERVICE_CARDS.length % 2 === 1 &&
                  "sm:max-lg:col-span-2 sm:max-lg:mx-auto sm:max-lg:w-full sm:max-lg:max-w-md"
              )}
            >
              <ServiceCardLink service={service} />
            </div>
          ))}
        </div>

        {/* One Medical-style capability cloud: everything the record actually watches. */}
        <div className="mx-auto mt-14 max-w-4xl text-center">
          <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
            One record, watching what matters
          </h2>
          <div className="mt-6">
            <ConditionsMarquee items={[...WHAT_WE_TRACK]} />
          </div>
          <p className="mt-2 text-sm text-charcoal-ink/60">
            All on one longitudinal record your care team actually reviews.
          </p>
        </div>
      </Section>

      <Section variant="sage">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
              How it works
            </p>
            <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
              From sign-up to ongoing care
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              Readings, reminders, doctor review, and coordinated follow-up stay
              connected on one record, so the next step is always clear.
            </p>
          </div>
          <MarketingMediaFrame
            media={{
              illustration: "connected-care",
              imageAlt: "Readings, reminders, and doctor review in one connected record",
            }}
          />
        </div>

        <div className="mt-12">
          <StepsExplorer
            steps={HOW_IT_WORKS_STEPS.map(({ title, body }) => ({ title, body }))}
            tone="navy"
          />
        </div>
      </Section>

      <Section>
        <DashboardPreview />
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Care that stays with you."
          description="Get started today, for yourself or someone you love."
          primaryHref="/signup"
          primaryLabel="Get started"
          secondaryHref={MARKETING_ROUTES.pricing}
          secondaryLabel="View pricing"
        />
      </Section>
    </>
  );
}
