import { notFound } from "next/navigation";
import Link from "next/link";
import { ProductPageTemplate } from "../_components/product-page-template";
import { getProductPage } from "../_content/products";
import { Section, SectionHeading } from "../_components/section";
import { ResourceCarousel } from "../_components/resource-carousel";
import { loadResourceArticles } from "@/lib/marketing/resources-data";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export const revalidate = 300;

export function generateMetadata() {
  const content = getProductPage("obesity");
  return content?.metadata ?? {};
}

export default async function ObesityPage() {
  const content = getProductPage("obesity");
  if (!content) notFound();

  const articles = await loadResourceArticles();
  const weightArticles = articles.filter((a) => a.category === "Weight");

  return (
    <ProductPageTemplate content={content}>
      <Section>
        <SectionHeading
          eyebrow="Try it yourself"
          title="Where do you stand today?"
          description="Two free, no-sign-up tools to start with: check your BMI range, or see how active a typical week actually is for you."
        />
        <div className="mx-auto grid max-w-3xl gap-6 sm:grid-cols-2">
          <Link
            href={MARKETING_ROUTES.bmiCalculator}
            className="rounded-xl border border-charcoal-ink/10 bg-white p-6 transition-colors hover:border-brand-green focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
          >
            <h3 className="font-heading text-lg font-semibold text-charcoal-ink">
              BMI & Calorie Calculator →
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">
              Your BMI range and an estimated daily calorie target.
            </p>
          </Link>
          <Link
            href={MARKETING_ROUTES.activityCalculator}
            className="rounded-xl border border-charcoal-ink/10 bg-white p-6 transition-colors hover:border-brand-green focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
          >
            <h3 className="font-heading text-lg font-semibold text-charcoal-ink">
              Activity Intensity Calculator →
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">
              Calories burned and how a session counts toward your weekly guideline.
            </p>
          </Link>
        </div>
      </Section>

      <Section>
        <div className="mx-auto max-w-3xl rounded-2xl border border-charcoal-ink/10 bg-white p-8">
          <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
            Honest expectations
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            This programme is lifestyle-led and doctor-reviewed: tracking, a personalised plan,
            monitoring for related conditions, and regular check-ins with escalation when closer
            care is needed. It does not currently include weight-loss medication (such as GLP-1
            injections) or any other prescribing specific to weight. If that&apos;s what
            you&apos;re looking for, say so at your first review, your doctor can talk you
            through the options available to you elsewhere.
          </p>
        </div>
      </Section>

      {weightArticles.length > 0 ? (
        <Section variant="sage">
          <ResourceCarousel
            title="Explore more Weight Management resources"
            articles={weightArticles}
          />
        </Section>
      ) : null}
    </ProductPageTemplate>
  );
}
