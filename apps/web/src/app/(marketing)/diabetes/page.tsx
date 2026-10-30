import { notFound } from "next/navigation";
import { ProductPageTemplate } from "../_components/product-page-template";
import { getProductPage } from "../_content/products";
import { Section, SectionHeading } from "../_components/section";
import { ResourceCarousel } from "../_components/resource-carousel";
import { ConditionMonitoringGrid, DIABETES_MONITORING } from "../_components/condition-monitoring";
import { HowTestingWorks } from "../_components/how-testing-works";
import { TestimonialsSection } from "../_components/testimonials-section";
import { DoctorTestimonialsSection } from "../_components/doctor-testimonials-section";
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
          statement="Complications of diabetes rarely begin with a very high reading. They begin with a normal reading that nobody checked again for months."
          support="HbA1c (your average blood sugar over three months) can rise for weeks before it causes any symptom. Tarragon keeps glucose, HbA1c and laboratory follow-up on one record, so a gradual rise is reviewed instead of being missed."
        />
      }
    >
      <Section>
        <SectionHeading
          eyebrow="What we monitor"
          title="Every check, and how often"
          description="Once a doctor places you on a diabetes care plan, this is what is tracked and how often."
        />
        <ConditionMonitoringGrid categories={DIABETES_MONITORING} />
      </Section>

      <Section variant="sage">
        <HowTestingWorks current="chronic" />
      </Section>

      <TestimonialsSection condition="diabetes" />

      <DoctorTestimonialsSection condition="diabetes" />

      {diabetesArticles.length > 0 ? (
        <Section variant="sage">
          <ResourceCarousel
            title="More resources on managing diabetes"
            articles={diabetesArticles}
          />
        </Section>
      ) : null}
    </ProductPageTemplate>
  );
}
