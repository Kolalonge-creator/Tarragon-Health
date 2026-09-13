import { notFound } from "next/navigation";
import { ProductPageTemplate } from "../_components/product-page-template";
import { getProductPage } from "../_content/products";
import { Section } from "../_components/section";
import { ResourceCarousel } from "../_components/resource-carousel";
import { PhoneMockup } from "../_components/phone-mockup";
import { loadResourceArticles } from "@/lib/marketing/resources-data";

export const revalidate = 300;

export function generateMetadata() {
  const content = getProductPage("medication");
  return content?.metadata ?? {};
}

// No resource-article "Medication" category exists (adherence content lives
// inside each condition's own category), so this page curates by slug rather
// than filtering by category the way the condition pages do.
const MEDICATION_RESOURCE_SLUGS = [
  "blood-pressure-medication-myths",
  "blood-pressure-medications-explained",
  "diabetes-medications-explained",
  "starting-insulin-what-to-expect",
  "statins-myths-explained",
];

export default async function MedicationPage() {
  const content = getProductPage("medication");
  if (!content) notFound();

  const articles = await loadResourceArticles();
  const medicationArticles = articles.filter((a) => MEDICATION_RESOURCE_SLUGS.includes(a.slug));

  return (
    <ProductPageTemplate content={content}>
      <Section variant="sage">
        <div className="mx-auto grid max-w-4xl items-center gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14">
          <PhoneMockup
            className="relative mx-auto"
            src="/marketing/photos/app-medications.png"
            alt="The TarragonHealth app's Medications screen, showing today's doses and a link to the medicines cabinet."
            width={1080}
            height={2238}
          />
          <div className="text-center lg:text-left">
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
              Your medicines cabinet
            </p>
            <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
              Every medication, one place to check it
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              Today&apos;s doses, active prescriptions, and refill status, all in one screen. Log what
              you took and your care team follows up directly if doses start slipping.
            </p>
          </div>
        </div>
      </Section>

      {medicationArticles.length > 0 ? (
        <Section variant="sage">
          <ResourceCarousel
            title="Explore more Medication resources"
            articles={medicationArticles}
          />
        </Section>
      ) : null}
    </ProductPageTemplate>
  );
}
