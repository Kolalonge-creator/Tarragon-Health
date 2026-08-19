import { notFound } from "next/navigation";
import { ProductPageTemplate } from "../_components/product-page-template";
import { getProductPage } from "../_content/products";
import { Section } from "../_components/section";
import { ResourceCarousel } from "../_components/resource-carousel";
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
      {labsArticles.length > 0 ? (
        <Section variant="sage">
          <ResourceCarousel title="Explore more Labs resources" articles={labsArticles} />
        </Section>
      ) : null}
    </ProductPageTemplate>
  );
}
