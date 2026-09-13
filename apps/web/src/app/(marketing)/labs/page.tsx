import { notFound } from "next/navigation";
import { ProductPageTemplate } from "../_components/product-page-template";
import { getProductPage } from "../_content/products";
import { Section } from "../_components/section";
import { ResourceCarousel } from "../_components/resource-carousel";
import { PhoneMockup } from "../_components/phone-mockup";
import { loadResourceArticles } from "@/lib/marketing/resources-data";

export const revalidate = 300;

export function generateMetadata() {
  const content = getProductPage("labs");
  return content?.metadata ?? {};
}

// No resource-article "Labs" category exists, so this page curates by slug
// rather than filtering by category the way the condition pages do.
const LABS_RESOURCE_SLUGS = [
  "annual-health-check-guide",
  "abnormal-screening-result-what-happens-next",
];

export default async function LabsPage() {
  const content = getProductPage("labs");
  if (!content) notFound();

  const articles = await loadResourceArticles();
  const labsArticles = articles.filter((a) => LABS_RESOURCE_SLUGS.includes(a.slug));

  return (
    <ProductPageTemplate content={content}>
      <Section>
        <div className="mx-auto grid max-w-4xl items-center gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14">
          <PhoneMockup
            className="relative mx-auto"
            src="/marketing/photos/app-labs-results.png"
            alt="The TarragonHealth app's Labs & results screen, with options to photograph a result or view past orders and results."
            width={1080}
            height={2238}
          />
          <div className="text-center lg:text-left">
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
              Any lab, one record
            </p>
            <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
              Photograph a result, we read it into your record
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              You pay the lab directly and take the test wherever you trust. Snap a photo of the
              result and it&apos;s on your record, in plain language, with a doctor reviewing it.
            </p>
          </div>
        </div>
      </Section>

      {labsArticles.length > 0 ? (
        <Section variant="sage">
          <ResourceCarousel title="Explore more Labs resources" articles={labsArticles} />
        </Section>
      ) : null}
    </ProductPageTemplate>
  );
}
