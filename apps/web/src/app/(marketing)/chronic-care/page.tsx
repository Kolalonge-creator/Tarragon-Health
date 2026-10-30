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
    "Ongoing monitoring for hypertension, diabetes and weight: readings, medication, labs and doctor review on one record, with referral to a doctor when needed.",
  path: MARKETING_ROUTES.chronicCare,
});

const CHRONIC_KEYS = ["hypertension", "diabetes", "obesity"] as const;
const CHRONIC_CARDS = SERVICE_CARDS.filter((card) =>
  (CHRONIC_KEYS as readonly string[]).includes(card.key)
);

const HOW = [
  {
    title: "Regular monitoring",
    body: "Record your blood pressure, blood sugar, weight and medication through the app or the website. A connected blood pressure cuff, glucometer or wearable can also add readings as we bring each one online. Either way, the readings are saved to one record that builds up over time.",
  },
  {
    title: "Reviewed between visits",
    body: "Your care team reviews your trends against care protocols and follows up with you when something needs attention.",
  },
  {
    title: "Referral to a doctor when needed",
    body: "A reading that needs closer attention is passed to a doctor through a defined pathway, so that nothing is missed between visits.",
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
        description="A long-term condition is managed mostly in the days between clinic visits, not during them. Tarragon monitors your readings, medication and laboratory results, and acts when something changes."
        primaryHref="/signup"
        primaryLabel="Start monitoring"
        secondaryHref={MARKETING_ROUTES.pricing}
        secondaryLabel="View pricing"
        imageSrc={MARKETING_MEDIA.pageHero.chronicCare.imageSrc ?? ""}
        imageAlt={MARKETING_MEDIA.pageHero.chronicCare.imageAlt ?? ""}
        imagePosition={MARKETING_MEDIA.pageHero.chronicCare.imageFocus}
        videoSrc={MARKETING_MEDIA.pageHero.chronicCare.videoSrc}
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
              Monitoring, review and doctor referral
            </h2>
          </div>
          <MarketingMediaFrame
            media={{
              illustration: "care-loop",
              imageAlt: "A continuous cycle of monitoring, review and referral to a doctor when needed",
            }}
          />
        </div>
        <div className="mt-10">
          <StepsExplorer steps={HOW} tone="navy" />
        </div>
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-charcoal-ink/70">
          If you are looking after a parent with a long-term condition,{" "}
          <Link href={MARKETING_ROUTES.parentcare} className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
            Caring for a parent
          </Link>{" "}
          offers the same monitoring for your relative, with family updates that they choose to share.
        </p>
        <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-charcoal-ink/70">
          Cholesterol and cardiovascular risk (the risk of heart disease and stroke) are followed on the
          same record, not in a separate programme. Your doctor reviews your cholesterol alongside
          your blood pressure and blood sugar, because they contribute to the same underlying risk.
        </p>
        <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-charcoal-ink/70">
          Living with a long-term condition can also affect your mental health. You can try our free two-minute{" "}
          <Link href={MARKETING_ROUTES.mentalWellbeingCheck} className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
            mental well-being check
          </Link>
          . No sign-up is required.
        </p>
      </Section>

      {cholesterolArticles.length > 0 ? (
        <Section>
          <ResourceCarousel
            title="More resources on cholesterol and heart health"
            articles={cholesterolArticles}
          />
        </Section>
      ) : null}

      <Section className="pb-24">
        <CtaBand
          title="Manage a long-term condition with support"
          description="Start monitoring today, with doctor review built in."
          primaryHref="/signup"
          primaryLabel="Start monitoring"
          secondaryHref={MARKETING_ROUTES.pricing}
          secondaryLabel="View pricing"
        />
      </Section>
    </>
  );
}
