import { notFound } from "next/navigation";
import { ProductPageTemplate } from "../_components/product-page-template";
import { getProductPage } from "../_content/products";
import { Section, SectionHeading } from "../_components/section";
import { ResourceCarousel } from "../_components/resource-carousel";
import { ConditionMonitoringGrid, HYPERTENSION_MONITORING } from "../_components/condition-monitoring";
import { HowTestingWorks } from "../_components/how-testing-works";
import { PhoneMockup } from "../_components/phone-mockup";
import { TestimonialsSection } from "../_components/testimonials-section";
import { DoctorTestimonialsSection } from "../_components/doctor-testimonials-section";
import { ConditionRiskNote } from "../_components/condition-risk-note";
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
    <ProductPageTemplate
      content={content}
      riskNote={
        <ConditionRiskNote
          eyebrow="Why this matters"
          statement="Most complications of hypertension do not come from one high reading. They come from months of gradual rise that nobody was monitoring."
          support="A blood pressure cuff only shows you your blood pressure at the moment you use it. Tarragon's care team follows the trend between your visits, so a slow rise leads to a call from us instead of a surprise."
        />
      }
    >
      <Section>
        <SectionHeading
          eyebrow="What we monitor"
          title="Every check, and how often"
          description="Once a doctor places you on a hypertension care plan, this is what is tracked and how often."
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
              Record a reading
            </p>
            <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
              Record a blood pressure reading in under a minute
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              Enter the systolic (upper) and diastolic (lower) numbers and the reading is saved. Every
              reading goes straight to your record, so your care team always has a current picture and
              does not depend on what you remember to mention at your next check-in.
            </p>
          </div>
        </div>
      </Section>

      <Section variant="sage">
        <HowTestingWorks current="chronic" />
      </Section>

      <TestimonialsSection condition="hypertension" />

      <DoctorTestimonialsSection condition="hypertension" />

      {bloodPressureArticles.length > 0 ? (
        <Section variant="sage">
          <ResourceCarousel
            title="More resources on blood pressure"
            articles={bloodPressureArticles}
          />
        </Section>
      ) : null}
    </ProductPageTemplate>
  );
}
