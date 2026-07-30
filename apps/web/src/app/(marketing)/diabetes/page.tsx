import { notFound } from "next/navigation";
import { ProductPageTemplate } from "../_components/product-page-template";
import { getProductPage } from "../_content/products";
import { Section } from "../_components/section";
import { ResourceCarousel } from "../_components/resource-carousel";
import { loadResourceArticles } from "@/lib/marketing/resources-data";

export const revalidate = 300;

export function generateMetadata() {
  const content = getProductPage("diabetes");
  return content?.metadata ?? {};
}

export default async function DiabetesPage() {
  const content = getProductPage("diabetes");
  if (!content) notFound();

  const articles = await loadResourceArticles();
  const diabetesArticles = articles.filter((a) => a.category === "Diabetes");

  return (
    <ProductPageTemplate content={content}>
      {diabetesArticles.length > 0 ? (
        <Section variant="sage">
          <ResourceCarousel
            title="Explore more Diabetes Management resources"
            articles={diabetesArticles}
          />
        </Section>
      ) : null}
    </ProductPageTemplate>
  );
}
