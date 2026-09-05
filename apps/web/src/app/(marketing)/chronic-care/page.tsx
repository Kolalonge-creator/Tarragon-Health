import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand } from "../_components/cta-band";
import { MarketingMediaFrame } from "../_components/marketing-media-frame";
import { PhotoBannerHero } from "../_components/marketing-photo-banner-hero";
import { Section } from "../_components/section";
import { ServiceCardLink } from "../_components/service-card";
import { StepsExplorer } from "../_components/steps-explorer";
import { SERVICE_CARDS } from "../_content/services";
import { MARKETING_MEDIA } from "../_content/media";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";
import { ResourceCarousel } from "../_components/resource-carousel";
import { loadResourceArticles } from "@/lib/marketing/resources-data";

export const revalidate = 300;

export const metadata: Metadata = pageMetadata({
  title: "Chronic care",
  description:
    "Ongoing monitoring for hypertension, diabetes and weight: readings, medication, labs and doctor review on one record, escalated when care is needed.",
  path: MARKETING_ROUTES.chronicCare,
});

const CHRONIC_KEYS = ["hypertension", "diabetes", "obesity"] as const;
const CHRONIC_CARDS = SERVICE_CARDS.filter((card) =>
  (CHRONIC_KEYS as readonly string[]).includes(card.key)
);

const HOW = [
  {
    title: "Consistent monitoring",
    body: "Log blood pressure, blood sugar, weight, and medication through the app or web, or let a connected BP cuff, glucometer, or wearable fill in the reading as we bring each device online. Either way, it lands on one longitudinal record.",
  },
  {
    title: "Reviewed between visits",
    body: "Your care team reviews your trends against care protocols and follows up when something needs attention.",
  },
  {
    title: "Escalation when needed",
    body: "A reading that needs closer care is escalated through a defined pathway, so nothing is missed between visits.",
  },
];

export default async function ChronicCarePage() {
  const articles = await loadResourceArticles();
  const cholesterolArticles = articles.filter((a) => a.category === "Cholesterol");

  return (
    <>
      {/* Rendered outside Section on purpose — full-bleed spans the full
          viewport width; see marketing-photo-banner-hero.tsx's header comment. */}
      <PhotoBannerHero
        eyebrow="Chronic care"
        title="Steady, followed-up care for long-term conditions"
        description="Chronic disease isn't managed in the clinic, it's managed in the days between visits. Tarragon keeps watch on your readings, medication, and labs, and acts when something changes."
        primaryHref="/signup"
        primaryLabel="Start monitoring"
        secondaryHref={MARKETING_ROUTES.pricing}
        secondaryLabel="View pricing"
        imageSrc={MARKETING_MEDIA.pageHero.chronicCare.imageSrc ?? ""}
        imageAlt={MARKETING_MEDIA.pageHero.chronicCare.imageAlt ?? ""}
        imagePosition={MARKETING_MEDIA.pageHero.chronicCare.imageFocus}
      />

      <Section className="pt-14">
        <div className="mx-auto grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {CHRONIC_CARDS.map((service) => (
            <ServiceCardLink key={service.key} service={service} />
          ))}
        </div>
      </Section>

      <Section variant="sage">
        <div className="mx-auto grid max-w-4xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="text-center lg:text-left">
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
              How chronic care works
            </p>
            <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
              Monitor, review, escalate
            </h2>
          </div>
          <MarketingMediaFrame
            media={{
              illustration: "care-loop",
              imageAlt: "A continuous loop: monitor, review, and escalate when needed",
            }}
          />
        </div>
        <div className="mt-10">
          <StepsExplorer steps={HOW} tone="navy" />
        </div>
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-charcoal-ink/70">
          Looking after a parent with a long-term condition?{" "}
          <Link href={MARKETING_ROUTES.parentcare} className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
            Caring for a parent
          </Link>{" "}
          brings the same monitoring together for a loved one, with opt-in family updates.
        </p>
        <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-charcoal-ink/70">
          Cholesterol and overall cardiovascular risk are watched alongside these conditions on the
          same record, not as a separate programme: your doctor factors your cholesterol readings
          into the same review that watches your blood pressure and blood sugar, because they
          drive the same underlying risk.
        </p>
        <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-charcoal-ink/70">
          Managing a chronic condition can weigh on you too. Try our free, two-minute{" "}
          <Link href={MARKETING_ROUTES.mentalWellbeingCheck} className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
            mental well-being check
          </Link>
          , no sign-up required.
        </p>
      </Section>

      {cholesterolArticles.length > 0 ? (
        <Section>
          <ResourceCarousel
            title="Explore more Cholesterol & Heart Health resources"
            articles={cholesterolArticles}
          />
        </Section>
      ) : null}

      <Section className="pb-24">
        <CtaBand
          title="Manage a chronic condition with support"
          description="Start monitoring today, with clinical review and escalation built in."
          primaryHref="/signup"
          primaryLabel="Start monitoring"
          secondaryHref={MARKETING_ROUTES.pricing}
          secondaryLabel="View pricing"
        />
      </Section>
    </>
  );
}
