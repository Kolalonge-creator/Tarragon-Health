import { notFound } from "next/navigation";
import { ProductPageTemplate } from "../_components/product-page-template";
import { getProductPage } from "../_content/products";
import { Section, SectionHeading } from "../_components/section";
import { ResourceCarousel } from "../_components/resource-carousel";
import { ConditionMonitoringGrid, HYPERTENSION_MONITORING } from "../_components/condition-monitoring";
import { HowTestingWorks } from "../_components/how-testing-works";
import { PhoneMockup } from "../_components/phone-mockup";
import { loadResourceArticles } from "@/lib/marketing/resources-data";

export const revalidate = 300;

export function generateMetadata() {
  const content = getProductPage("hypertension");
  return content?.metadata ?? {};
}

export default async function HypertensionPage() {
  const content = getProductPage("hypertension");
  if (!content) notFound();

  const articles = await loadResourceArticles();
  const bloodPressureArticles = articles.filter((a) => a.category === "Blood pressure");

  return (
    <ProductPageTemplate content={content}>
      <Section>
        <SectionHeading
          eyebrow="What we monitor"
          title="Every check, and how often"
          description="Once your doctor puts you on a hypertension care plan, here's exactly what gets tracked, and on what schedule."
        />
        <ConditionMonitoringGrid categories={HYPERTENSION_MONITORING} />
      </Section>

      <Section>
        <div className="mx-auto grid max-w-4xl items-center gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14">
          <PhoneMockup
            className="relative mx-auto"
            src="/marketing/photos/app-vitals-log.png"
            alt="The TarragonHealth app's blood pressure logging screen, with fields for systolic and diastolic readings and a list of recent readings."
            width={1080}
            height={2238}
          />
          <div className="text-center lg:text-left">
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
              Log a reading
            </p>
            <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
              A blood pressure reading, logged in under a minute
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              Systolic, diastolic, and you&apos;re done. Every reading lands straight on your record,
              so your care team always has a current picture, not just whatever you remember to
              mention at your next check-in.
            </p>
          </div>
        </div>
      </Section>

      <Section variant="sage">
        <HowTestingWorks current="chronic" />
      </Section>

      {bloodPressureArticles.length > 0 ? (
        <Section variant="sage">
          <ResourceCarousel
            title="Explore more Blood Pressure resources"
            articles={bloodPressureArticles}
          />
        </Section>
      ) : null}
    </ProductPageTemplate>
  );
}
