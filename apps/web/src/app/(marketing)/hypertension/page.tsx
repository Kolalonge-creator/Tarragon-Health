import { notFound } from "next/navigation";
import { ProductPageTemplate } from "../_components/product-page-template";
import { getProductPage } from "../_content/products";
import { Section } from "../_components/section";
import { ResourceCarousel } from "../_components/resource-carousel";
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
