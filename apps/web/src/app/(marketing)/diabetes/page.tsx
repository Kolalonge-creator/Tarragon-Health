import { notFound } from "next/navigation";
import { ProductPageTemplate } from "../_components/product-page-template";
import { getProductPage } from "../_content/products";
import { Section, SectionHeading } from "../_components/section";
import { ResourceCarousel } from "../_components/resource-carousel";
import { ConditionMonitoringGrid, DIABETES_MONITORING } from "../_components/condition-monitoring";
import { HowTestingWorks } from "../_components/how-testing-works";
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
      <Section>
        <SectionHeading
          eyebrow="What we monitor"
          title="Every check, and how often"
          description="Once your doctor puts you on a diabetes care plan, here's exactly what gets tracked, and on what schedule."
        />
        <ConditionMonitoringGrid categories={DIABETES_MONITORING} />
      </Section>

      <Section variant="sage">
        <HowTestingWorks current="chronic" />
      </Section>

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
