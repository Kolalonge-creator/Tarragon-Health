import { notFound } from "next/navigation";
import { ProductPageTemplate } from "../_components/product-page-template";
import { getProductPage } from "../_content/products";
import { Section, SectionHeading } from "../_components/section";
import { ResourceCarousel } from "../_components/resource-carousel";
import { ConditionMonitoringGrid, DIABETES_MONITORING } from "../_components/condition-monitoring";
import { HowTestingWorks } from "../_components/how-testing-works";
import { ConditionRiskNote } from "../_components/condition-risk-note";
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
    <ProductPageTemplate
      content={content}
      riskNote={
        <ConditionRiskNote
          eyebrow="Why this matters"
          statement="Diabetes complications rarely start with a bad number. They start with a normal one nobody checked again for months."
          support="HbA1c can drift for weeks before it ever becomes a symptom. Tarragon keeps glucose, HbA1c, and lab follow-up on one record, so a quiet drift gets reviewed, not missed."
        />
      }
    >
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
