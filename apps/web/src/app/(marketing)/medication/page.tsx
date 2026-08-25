import { notFound } from "next/navigation";
import { ProductPageTemplate } from "../_components/product-page-template";
import { getProductPage } from "../_content/products";
import { Section } from "../_components/section";
import { ResourceCarousel } from "../_components/resource-carousel";
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
